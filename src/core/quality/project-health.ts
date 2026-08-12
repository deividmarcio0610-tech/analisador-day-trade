import fs from 'node:fs/promises';
import path from 'node:path';
import type { Verdict } from '@/core/types';
import { workspaceRoot } from '@/core/paths';
import { detectStack } from '@/core/tools/stack-detect';
import { gitStatus } from '@/core/tools/git';
import { listTestRuns } from '@/core/tools/verification';
import { analyzeTechnicalDebt } from './tech-debt';
import { providerStatuses } from '@/core/providers/registry';

/**
 * PROJECT HEALTH
 *
 * Every number here comes from a real observation. A dimension with no
 * observation is NOT_RUN — the dashboard never shows a green tick for something
 * that was never executed.
 */

export interface HealthDimension {
  key: string;
  label: string;
  verdict: Verdict;
  detail: string;
  value?: number;
}

export interface ProjectHealth {
  dimensions: HealthDimension[];
  score: number | null;
  collectedAt: string;
}

export async function projectHealth(): Promise<ProjectHealth> {
  const root = workspaceRoot();
  const dimensions: HealthDimension[] = [];

  const stack = await detectStack(root);
  dimensions.push({
    key: 'stack',
    label: 'Stack detection',
    verdict: stack.languages.length > 0 ? 'PASS' : 'NOT_RUN',
    detail:
      stack.languages.length > 0
        ? `${stack.languages.join(', ')} · ${stack.packageManager ?? 'no package manager'}`
        : 'no recognised project files',
  });

  const runs = listTestRuns(20);
  const lastTest = runs[0];
  dimensions.push({
    key: 'tests',
    label: 'Tests',
    verdict: lastTest ? lastTest.verdict : 'NOT_RUN',
    detail: lastTest
      ? `${lastTest.command} → exit ${lastTest.exitCode ?? 'null'}${
          lastTest.total !== null ? ` (${lastTest.passed ?? 0}/${lastTest.total})` : ''
        }`
      : 'no test run recorded by this platform yet',
    value: lastTest?.total ?? undefined,
  });

  dimensions.push({
    key: 'build',
    label: 'Build',
    verdict: 'NOT_RUN',
    detail: stack.commands.build
      ? `command available: ${stack.commands.build} — run /build to produce evidence`
      : 'no build command detected',
  });

  const git = await gitStatus();
  dimensions.push({
    key: 'git',
    label: 'Git status',
    verdict: git.available ? (git.clean ? 'PASS' : 'NOT_RUN') : 'NOT_RUN',
    detail: git.available
      ? `${git.branch ?? 'detached'} · ${git.files.length} changed file(s) · ahead ${git.ahead}, behind ${git.behind}`
      : 'not a git repository',
    value: git.files.length,
  });

  const dependencies = await countDependencies(root);
  dimensions.push({
    key: 'dependencies',
    label: 'Dependencies',
    verdict: dependencies === null ? 'NOT_RUN' : 'PASS',
    detail: dependencies === null ? 'no package.json' : `${dependencies} declared package(s)`,
    value: dependencies ?? undefined,
  });

  const debt = await analyzeTechnicalDebt(root);
  const debtCount = debt.markers.length + debt.circularImports.length;
  dimensions.push({
    key: 'debt',
    label: 'Technical debt',
    verdict: debtCount === 0 ? 'PASS' : 'FAIL',
    detail: `${debt.markers.length} marker(s), ${debt.largeFiles.length} large file(s), ${debt.circularImports.length} import cycle(s)`,
    value: debtCount,
  });

  const providers = await providerStatuses();
  const online = providers.filter((provider) => provider.health.status === 'ONLINE');
  dimensions.push({
    key: 'models',
    label: 'Model providers',
    verdict: online.length > 0 ? 'PASS' : 'NOT_RUN',
    detail:
      online.length > 0
        ? `${online.length}/${providers.length} online: ${online.map((provider) => provider.id).join(', ')}`
        : `no provider online (${providers.map((provider) => `${provider.id}:${provider.health.status}`).join(', ')})`,
  });

  const scored = dimensions.filter((dimension) => dimension.verdict === 'PASS' || dimension.verdict === 'FAIL');
  const score =
    scored.length === 0
      ? null
      : Math.round((scored.filter((dimension) => dimension.verdict === 'PASS').length / scored.length) * 100);

  return { dimensions, score, collectedAt: new Date().toISOString() };
}

async function countDependencies(root: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
  } catch {
    return null;
  }
}
