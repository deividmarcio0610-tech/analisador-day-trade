import fs from 'node:fs/promises';
import path from 'node:path';
import { workspaceRoot } from '@/core/paths';

/**
 * Project stack detection.
 *
 * Commands are derived from what the project actually declares (package.json
 * scripts, pyproject, csproj). When nothing is declared the corresponding
 * capability is reported as unavailable instead of being guessed.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type TestRunner = 'vitest' | 'jest' | 'playwright' | 'pytest' | 'dotnet' | 'go' | 'cargo' | 'unknown';

export interface DetectedStack {
  root: string;
  languages: string[];
  packageManager: PackageManager | null;
  scripts: Record<string, string>;
  testRunners: TestRunner[];
  commands: {
    install: string | null;
    lint: string | null;
    typecheck: string | null;
    test: string | null;
    e2e: string | null;
    build: string | null;
  };
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function detectStack(root = workspaceRoot()): Promise<DetectedStack> {
  const pkg = await readJson<PackageJson>(path.join(root, 'package.json'));
  const languages: string[] = [];
  const testRunners: TestRunner[] = [];

  const packageManager = await detectPackageManager(root, pkg);
  const scripts = pkg?.scripts ?? {};
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };

  if (pkg) languages.push('javascript');
  if (await exists(path.join(root, 'tsconfig.json'))) languages.push('typescript');
  if (
    (await exists(path.join(root, 'pyproject.toml'))) ||
    (await exists(path.join(root, 'requirements.txt')))
  ) {
    languages.push('python');
  }
  if (await exists(path.join(root, 'go.mod'))) languages.push('go');
  if (await exists(path.join(root, 'Cargo.toml'))) languages.push('rust');

  if (deps.vitest) testRunners.push('vitest');
  if (deps.jest) testRunners.push('jest');
  if (deps['@playwright/test'] || deps.playwright) testRunners.push('playwright');
  if (languages.includes('python') && (await hasPytest(root))) testRunners.push('pytest');
  if (languages.includes('go')) testRunners.push('go');
  if (languages.includes('rust')) testRunners.push('cargo');

  const run = runner(packageManager);

  const commands = {
    install: packageManager ? `${packageManager} install` : null,
    lint: scripts.lint ? `${run} lint` : null,
    typecheck: scripts.typecheck
      ? `${run} typecheck`
      : languages.includes('typescript')
        ? 'npx tsc --noEmit'
        : null,
    test: pickTestCommand(scripts, run, testRunners, languages),
    e2e: scripts['test:e2e']
      ? `${run} test:e2e`
      : testRunners.includes('playwright')
        ? 'npx playwright test'
        : null,
    build: scripts.build ? `${run} build` : languages.includes('go') ? 'go build ./...' : null,
  };

  return { root, languages, packageManager, scripts, testRunners, commands };
}

function runner(pm: PackageManager | null): string {
  if (pm === 'pnpm') return 'pnpm run';
  if (pm === 'yarn') return 'yarn';
  if (pm === 'bun') return 'bun run';
  return 'npm run';
}

function pickTestCommand(
  scripts: Record<string, string>,
  run: string,
  runners: TestRunner[],
  languages: string[],
): string | null {
  if (scripts.test) return `${run} test`;
  if (runners.includes('vitest')) return 'npx vitest run';
  if (runners.includes('jest')) return 'npx jest';
  if (runners.includes('pytest')) return 'python -m pytest -q';
  if (languages.includes('go')) return 'go test ./...';
  if (languages.includes('rust')) return 'cargo test';
  return null;
}

async function detectPackageManager(
  root: string,
  pkg: PackageJson | null,
): Promise<PackageManager | null> {
  if (pkg?.packageManager) {
    const name = pkg.packageManager.split('@')[0];
    if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') return name;
  }
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb'))) return 'bun';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return pkg ? 'npm' : null;
}

async function hasPytest(root: string): Promise<boolean> {
  if (await exists(path.join(root, 'pytest.ini'))) return true;
  const pyproject = path.join(root, 'pyproject.toml');
  if (await exists(pyproject)) {
    const content = await fs.readFile(pyproject, 'utf8').catch(() => '');
    if (content.includes('pytest')) return true;
  }
  const requirements = path.join(root, 'requirements.txt');
  if (await exists(requirements)) {
    const content = await fs.readFile(requirements, 'utf8').catch(() => '');
    if (content.includes('pytest')) return true;
  }
  return false;
}
