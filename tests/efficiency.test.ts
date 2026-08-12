import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The layers that decide how much work — and how many tokens — a task costs:
 * the incremental index, the token budget, the model cache and test selection.
 */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-eff-'));

const write = (relative: string, content: string): void => {
  const target = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

beforeAll(() => {
  process.env.VISION_WORKSPACE_ROOT = workspace;
  process.env.VISION_DATA_DIR = path.join(workspace, '.vision');
  write('package.json', JSON.stringify({ name: 'eff', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^3' } }));
  write('src/math.ts', 'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\n');
  write('src/user.ts', "import { addNumbers } from './math';\nexport const total = () => addNumbers(1, 2);\n");
  write('tests/math.test.ts', "import { addNumbers } from '../src/math';\nit('adds', () => addNumbers(1, 2));\n");
  write('tests/unrelated.test.ts', "it('unrelated', () => 1);\n");
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('repository index', () => {
  it('indexes on the first pass and re-parses nothing on the second', async () => {
    const { refreshIndex } = await import('@/core/context/repo-index');
    const first = await refreshIndex();
    expect(first.indexed).toBeGreaterThan(0);

    const second = await refreshIndex();
    expect(second.indexed).toBe(0);
    expect(second.changed).toHaveLength(0);
    expect(second.unchanged).toBeGreaterThan(0);
  });

  it('re-indexes only the file whose content changed', async () => {
    const { refreshIndex } = await import('@/core/context/repo-index');
    await refreshIndex();
    write('src/math.ts', 'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\nexport const VERSION = 2;\n');
    const stats = await refreshIndex();
    expect(stats.changed).toEqual(['src/math.ts']);
    expect(stats.indexed).toBe(1);
  });

  it('extracts declared symbols and imports', async () => {
    const { extractSymbols, extractImports } = await import('@/core/context/repo-index');
    const source = [
      "import { helper } from './helper';",
      'export function compute(): void {}',
      'export const NAME = 1;',
      'class Widget {}',
      'export { Widget as Thing };',
    ].join('\n');
    const symbols = extractSymbols(source);
    expect(symbols).toContain('compute');
    expect(symbols).toContain('NAME');
    expect(symbols).toContain('Widget');
    expect(symbols).toContain('Thing');
    expect(extractImports(source)).toEqual(['./helper']);
  });

  it('finds where a symbol is declared', async () => {
    const { refreshIndex, findSymbol } = await import('@/core/context/repo-index');
    await refreshIndex();
    expect(findSymbol('addNumbers').map((hit) => hit.path)).toContain('src/math.ts');
  });

  it('drops files that disappeared', async () => {
    const { refreshIndex, indexedFile } = await import('@/core/context/repo-index');
    write('src/temporary.ts', 'export const gone = true;\n');
    await refreshIndex();
    expect(indexedFile('src/temporary.ts')).not.toBeNull();

    fs.rmSync(path.join(workspace, 'src/temporary.ts'));
    const stats = await refreshIndex();
    expect(stats.removed).toBe(1);
    expect(indexedFile('src/temporary.ts')).toBeNull();
  });
});

describe('token budget', () => {
  it('gives cheap modes less context and fewer rounds', async () => {
    const { budgetForMode } = await import('@/core/orchestrator/token-budget');
    const fast = budgetForMode('FAST');
    const team = budgetForMode('TEAM');
    expect(fast.contextChars).toBeLessThan(team.contextChars);
    expect(fast.maxRounds).toBeLessThan(team.maxRounds);
    expect(fast.roles).toEqual(['builder']);
  });

  it('records consumption and marks estimates as estimates', async () => {
    const { recordUsage, usageForTask } = await import('@/core/orchestrator/token-budget');
    recordUsage({
      taskId: 'task-budget',
      role: 'builder',
      model: 'm',
      promptTokens: 100,
      completionTokens: 50,
      estimated: false,
      cached: false,
    });
    recordUsage({
      taskId: 'task-budget',
      role: 'reviewer',
      model: 'm',
      promptTokens: 10,
      completionTokens: 5,
      estimated: true,
      cached: true,
    });

    const usage = usageForTask('task-budget');
    expect(usage.calls).toBe(2);
    expect(usage.totalTokens).toBe(165);
    expect(usage.cachedCalls).toBe(1);
    expect(usage.partlyEstimated).toBe(true);
  });

  it('detects when a task has spent its allowance', async () => {
    const { recordUsage, budgetExceeded, BUDGETS } = await import('@/core/orchestrator/token-budget');
    expect(budgetExceeded('task-spend', BUDGETS.LOW)).toBe(false);
    recordUsage({
      taskId: 'task-spend',
      role: 'builder',
      model: 'm',
      promptTokens: BUDGETS.LOW.maxTotalTokens,
      completionTokens: 1,
      estimated: true,
      cached: false,
    });
    expect(budgetExceeded('task-spend', BUDGETS.LOW)).toBe(true);
  });
});

describe('model cache', () => {
  it('reuses an answer while the sources are unchanged', async () => {
    const { refreshIndex } = await import('@/core/context/repo-index');
    const { store, lookup, clearCache } = await import('@/core/providers/model-cache');
    clearCache();
    await refreshIndex();

    const input = {
      role: 'builder',
      model: 'm',
      system: 'S',
      user: 'U',
      contextFiles: ['src/math.ts'],
    };
    expect(lookup(input)).toBeNull();
    store(input, '{"summary":"ok"}');
    expect(lookup(input)?.response).toBe('{"summary":"ok"}');
  });

  it('invalidates when a source file changes', async () => {
    const { refreshIndex } = await import('@/core/context/repo-index');
    const { store, lookup, clearCache } = await import('@/core/providers/model-cache');
    clearCache();
    await refreshIndex();

    const input = { role: 'builder', model: 'm', system: 'S', user: 'U', contextFiles: ['src/user.ts'] };
    store(input, 'cached answer');
    expect(lookup(input)).not.toBeNull();

    write('src/user.ts', "import { addNumbers } from './math';\nexport const total = () => addNumbers(3, 4);\n");
    await refreshIndex();
    expect(lookup(input)).toBeNull();
  });

  it('does not confuse different prompts', async () => {
    const { store, lookup, clearCache } = await import('@/core/providers/model-cache');
    clearCache();
    store({ role: 'builder', model: 'm', system: 'S', user: 'first' }, 'A');
    expect(lookup({ role: 'builder', model: 'm', system: 'S', user: 'second' })).toBeNull();
    expect(lookup({ role: 'builder', model: 'm', system: 'S', user: 'first' })?.response).toBe('A');
  });

  it('does not cache an empty answer', async () => {
    const { store, lookup, clearCache } = await import('@/core/providers/model-cache');
    clearCache();
    const input = { role: 'builder', model: 'm', system: 'S', user: 'empty' };
    store(input, '   ');
    expect(lookup(input)).toBeNull();
  });
});

describe('test prioritization', () => {
  it('picks the tests that cover the changed file', async () => {
    const { planTests } = await import('@/core/tools/test-selection');
    const plan = await planTests(['src/math.ts'], { root: workspace });
    expect(plan.targeted).toContain('tests/math.test.ts');
    expect(plan.targeted).not.toContain('tests/unrelated.test.ts');
    expect(plan.targetedCommand).toContain('vitest');
  });

  it('never claims a narrowed run replaces the full suite', async () => {
    const { planTests } = await import('@/core/tools/test-selection');
    const plan = await planTests(['src/math.ts'], { root: workspace });
    expect(plan.fullSuiteRequired).toBe(true);
    expect(plan.fullCommand).toBe('npm run test');
  });

  it('falls back to the full suite when nothing can be narrowed', async () => {
    const { planTests } = await import('@/core/tools/test-selection');
    const plan = await planTests([], { root: workspace });
    expect(plan.targeted).toHaveLength(0);
    expect(plan.targetedCommand).toBeNull();
    expect(plan.reason).toContain('nothing can be narrowed');
  });
});
