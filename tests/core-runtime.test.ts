import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Runtime tests for the pieces that touch the filesystem, the database and real
 * processes. They run against a temporary workspace, never the repository.
 */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-'));

beforeAll(() => {
  process.env.VISION_WORKSPACE_ROOT = workspace;
  process.env.VISION_DATA_DIR = path.join(workspace, '.vision');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), "import { b } from './b';\nexport const a = () => b();\n");
  fs.writeFileSync(path.join(workspace, 'src', 'b.ts'), 'export const b = () => 42;\n');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok' } }, null, 2),
  );
  fs.mkdirSync(path.join(workspace, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'node_modules', 'junk', 'index.js'), 'module.exports = 1;\n');
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('filesystem sandbox', () => {
  it('refuses to resolve outside the workspace root', async () => {
    const { resolveInside, PathEscapeError } = await import('@/core/paths');
    expect(() => resolveInside(workspace, '../../etc/passwd')).toThrow(PathEscapeError);
    expect(() => resolveInside(workspace, 'src/a.ts')).not.toThrow();
  });

  it('lists files and skips ignored directories', async () => {
    const { listDirectory, walkFiles } = await import('@/core/tools/filesystem');
    const entries = await listDirectory('.');
    expect(entries.map((entry) => entry.name)).not.toContain('node_modules');

    const files = await walkFiles('.', { root: workspace });
    expect(files).toContain('src/a.ts');
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
  });

  it('reads and writes files inside the workspace', async () => {
    const { readFile, writeFile } = await import('@/core/tools/filesystem');
    await writeFile('src/new.ts', 'export const x = 1;\n');
    expect((await readFile('src/new.ts')).content).toContain('export const x');
  });

  it('searches file contents', async () => {
    const { searchContent } = await import('@/core/tools/filesystem');
    const matches = await searchContent('export const b');
    expect(matches[0]?.path).toBe('src/b.ts');
  });
});

describe('stack detection', () => {
  it('derives commands from the project package.json', async () => {
    const { detectStack } = await import('@/core/tools/stack-detect');
    const stack = await detectStack(workspace);
    expect(stack.languages).toContain('javascript');
    expect(stack.commands.test).toBe('npm run test');
    expect(stack.commands.lint).toBeNull();
  });
});

describe('code graph', () => {
  it('resolves relative imports into edges', async () => {
    const { buildCodeGraph, dependentsOf, dependenciesOf } = await import('@/core/context/code-graph');
    const graph = await buildCodeGraph({ root: workspace, force: true });
    expect(graph.nodes.some((node) => node.id === 'src/a.ts')).toBe(true);
    expect(dependenciesOf(graph, 'src/a.ts')).toContain('src/b.ts');
    expect(dependentsOf(graph, 'src/b.ts')).toContain('src/a.ts');
  });
});

describe('process runner', () => {
  it('captures stdout and the exit code of a real process', async () => {
    const { runCommand } = await import('@/core/tools/process-runner');
    const result = await runCommand({ commandLine: 'echo vision-ok' });
    expect(result.stdout.trim()).toBe('vision-ok');
    expect(result.exitCode).toBe(0);
  });

  it('reports a non-zero exit code instead of throwing', async () => {
    const { runCommand } = await import('@/core/tools/process-runner');
    const result = await runCommand({ commandLine: 'exit 3' });
    expect(result.exitCode).toBe(3);
  });

  it('blocks CRITICAL commands unless confirmed', async () => {
    const { runCommand, CommandBlockedError } = await import('@/core/tools/process-runner');
    await expect(runCommand({ commandLine: 'rm -rf /tmp/does-not-exist-vision' })).rejects.toBeInstanceOf(
      CommandBlockedError,
    );
  });
});

describe('persistence', () => {
  it('creates the schema and round-trips a job with its events', async () => {
    const { createJob, emit, eventsSince, getJob, setJobState } = await import(
      '@/core/orchestrator/job-store'
    );
    const job = createJob({ projectId: 'p1', mode: 'FAST', command: 'solve', prompt: 'do a thing' });
    emit(job.id, 'log', { level: 'INFO', message: 'hello' });
    setJobState(job.id, 'RUNNING');

    const events = eventsSince(job.id, 0);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(getJob(job.id)?.state).toBe('RUNNING');
    expect(events.some((event) => event.type === 'log')).toBe(true);
  });

  it('stores and reads project memory and failures', async () => {
    const { rememberMemory, listMemories, recordFailure, relevantFailures, memoryDigest } = await import(
      '@/core/memory/memory'
    );
    rememberMemory({
      projectId: 'p1',
      kind: 'convention',
      title: 'Naming',
      body: 'Repositories end with -repo',
    });
    expect(listMemories('p1').length).toBeGreaterThan(0);

    recordFailure({
      projectId: 'p1',
      problem: 'websocket reconnect storm',
      attempt: 'increase retry limit',
      result: 'still storms',
      cause: 'no backoff',
      validSolution: null,
      test: null,
    });
    expect(relevantFailures('p1', 'websocket reconnect').length).toBe(1);
    expect(memoryDigest('p1', 'websocket reconnect')).toContain('ALREADY FAILED');
  });

  it('persists settings and keeps defaults for unknown keys', async () => {
    const { setOrchestratorConfig, getOrchestratorConfig } = await import('@/core/config/config');
    setOrchestratorConfig({ maxRounds: 5 });
    const config = getOrchestratorConfig();
    expect(config.maxRounds).toBe(5);
    expect(config.defaultMode).toBe('ENGINEER');
  });
});

describe('providers', () => {
  it('reports OFFLINE with a real reason when the endpoint is unreachable', async () => {
    const { OllamaProvider } = await import('@/core/providers/ollama-provider');
    const provider = new OllamaProvider({
      id: 'test',
      label: 'test',
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:59999',
      enabled: true,
    });
    const health = await provider.health();
    expect(health.status).toBe('OFFLINE');
    expect(health.detail.length).toBeGreaterThan(0);
  });

  it('reports NOT_CONFIGURED for a disabled provider instead of pretending', async () => {
    const { setProviders } = await import('@/core/config/config');
    const { providerStatuses } = await import('@/core/providers/registry');
    setProviders([
      { id: 'off', label: 'Disabled', kind: 'ollama', baseUrl: 'http://127.0.0.1:1', enabled: false },
    ]);
    const statuses = await providerStatuses();
    expect(statuses[0]?.health.status).toBe('NOT_CONFIGURED');
  });
});

describe('verification engine', () => {
  it('returns NOT_RUN when the project has no such command', async () => {
    const { runCheck } = await import('@/core/tools/verification');
    const evidence = await runCheck('lint');
    expect(evidence.verdict).toBe('NOT_RUN');
    expect(evidence.summary).toContain('No lint command');
  });

  it('runs the project test command and records evidence', async () => {
    const { runCheck, listTestRuns } = await import('@/core/tools/verification');
    const evidence = await runCheck('test');
    expect(evidence.verdict).toBe('PASS');
    expect(evidence.command).toBe('npm run test');
    expect(listTestRuns(5).length).toBeGreaterThan(0);
  });
});

describe('patch service', () => {
  it('previews a patch as a real diff without touching disk', async () => {
    const { previewPatch } = await import('@/core/orchestrator/patch-service');
    const preview = await previewPatch([
      { path: 'src/b.ts', action: 'update', content: 'export const b = () => 43;\n' },
    ]);
    expect(preview.additions).toBe(1);
    expect(preview.deletions).toBe(1);
    expect(fs.readFileSync(path.join(workspace, 'src', 'b.ts'), 'utf8')).toContain('42');
  });

  it('writes the files when the patch is applied', async () => {
    const { storePatch, applyPatch, getPatch } = await import('@/core/orchestrator/patch-service');
    const patch = storePatch({
      taskId: 'task-1',
      round: 1,
      author: 'builder',
      operations: [{ path: 'src/applied.ts', action: 'create', content: 'export const applied = true;\n' }],
    });
    const result = await applyPatch(patch.id);
    expect(result.errors).toHaveLength(0);
    expect(result.written).toContain('src/applied.ts');
    expect(fs.existsSync(path.join(workspace, 'src', 'applied.ts'))).toBe(true);
    expect(getPatch(patch.id)?.applied).toBe(true);
  });

  it('refuses to apply the same patch twice', async () => {
    const { storePatch, applyPatch } = await import('@/core/orchestrator/patch-service');
    const patch = storePatch({
      taskId: 'task-2',
      round: 1,
      author: 'builder',
      operations: [{ path: 'src/once.ts', action: 'create', content: 'export const once = 1;\n' }],
    });
    await applyPatch(patch.id);
    await expect(applyPatch(patch.id)).rejects.toThrow('already applied');
  });
});
