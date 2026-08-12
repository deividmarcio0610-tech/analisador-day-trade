import path from 'node:path';
import { analyzeImpact } from '@/core/context/impact';
import { walkFiles } from '@/core/tools/filesystem';
import { detectStack } from './stack-detect';
import { workspaceRoot } from '@/core/paths';

/**
 * TEST PRIORITIZATION
 *
 * Running the whole suite after every small edit is slow and mostly wasted. The
 * code graph already knows which modules a change reaches, so the tests that
 * cover those modules run first.
 *
 * The narrowed run is explicitly a *first pass*: `fullSuiteRequired` stays true,
 * because a green subset is not the same claim as a green suite, and the judge
 * is never told otherwise.
 */

export interface TestPlan {
  /** Tests directly related to the changed files, in priority order. */
  targeted: string[];
  /** Every test file discovered in the project. */
  all: string[];
  /** Command that runs only the targeted tests, when the runner supports it. */
  targetedCommand: string | null;
  /** Command that runs everything. */
  fullCommand: string | null;
  /** A narrowed run never substitutes for the full suite before completion. */
  fullSuiteRequired: boolean;
  reason: string;
}

const TEST_PATTERN = /\.(test|spec)\.[tj]sx?$/;

export async function planTests(
  changedFiles: string[],
  options: { root?: string } = {},
): Promise<TestPlan> {
  const root = options.root ?? workspaceRoot();
  const stack = await detectStack(root);
  const all = (await walkFiles('.', { root })).filter((file) => TEST_PATTERN.test(file));

  if (changedFiles.length === 0) {
    return {
      targeted: [],
      all,
      targetedCommand: null,
      fullCommand: stack.commands.test,
      fullSuiteRequired: true,
      reason: 'no changed files were given, so nothing can be narrowed',
    };
  }

  const impact = await analyzeImpact(changedFiles, { root });
  const targeted = new Set<string>();

  // 1. A changed test file is itself the first thing to run.
  for (const file of changedFiles) if (TEST_PATTERN.test(file)) targeted.add(file);
  // 2. Tests the impact analyzer tied to the changed modules.
  for (const file of impact.relatedTests) targeted.add(file);
  // 3. Tests whose name matches a changed file's stem.
  for (const file of changedFiles) {
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    if (stem.length < 3) continue;
    for (const candidate of all) if (candidate.includes(stem)) targeted.add(candidate);
  }

  const ordered = [...targeted].sort();
  const runner = stack.testRunners[0];
  const targetedCommand = ordered.length > 0 ? commandFor(runner, ordered) : null;

  return {
    targeted: ordered,
    all,
    targetedCommand,
    fullCommand: stack.commands.test,
    fullSuiteRequired: true,
    reason:
      ordered.length === 0
        ? 'no test could be tied to the changed files — only the full suite can say anything'
        : `${ordered.length} of ${all.length} test file(s) cover the changed modules`,
  };
}

/** Runner-specific invocation for a subset. Null when the runner is unknown. */
function commandFor(runner: string | undefined, files: string[]): string | null {
  const list = files.map((file) => JSON.stringify(file)).join(' ');
  switch (runner) {
    case 'vitest':
      return `npx vitest run ${list}`;
    case 'jest':
      return `npx jest ${list}`;
    case 'playwright':
      return `npx playwright test ${list}`;
    case 'pytest':
      return `python -m pytest -q ${list}`;
    default:
      return null;
  }
}
