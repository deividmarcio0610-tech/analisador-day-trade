import type { EvidenceItem, Verdict } from '@/core/types';
import { detectStack } from './stack-detect';
import { runCommand } from './process-runner';
import { truncateTail } from '@/core/util/text';
import { newId, nowIso } from '@/core/util/id';
import { getDb } from '@/core/db/database';

/**
 * TEST ENGINE / VERIFICATION
 *
 * Runs the project's own commands and converts the raw result into evidence.
 * A check that has no command in this project is NOT_RUN — never PASS.
 */

export type CheckKind = 'lint' | 'typecheck' | 'test' | 'e2e' | 'build';

export interface CheckOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  taskId?: string;
  onOutput?: (chunk: string) => void;
}

const KIND_TO_EVIDENCE: Record<CheckKind, EvidenceItem['kind']> = {
  lint: 'lint',
  typecheck: 'typecheck',
  test: 'test',
  e2e: 'test',
  build: 'build',
};

export async function runCheck(kind: CheckKind, options: CheckOptions = {}): Promise<EvidenceItem> {
  const stack = await detectStack();
  const command = stack.commands[kind];
  if (!command) {
    return {
      kind: KIND_TO_EVIDENCE[kind],
      label: kind,
      verdict: 'NOT_RUN',
      summary: `No ${kind} command detected for this project`,
    };
  }

  const result = await runCommand({
    commandLine: command,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 20 * 60_000,
    signal: options.signal,
    taskId: options.taskId,
    confirmed: true,
    onStdout: options.onOutput,
    onStderr: options.onOutput,
  });

  const output = `${result.stdout}${result.stderr}`;
  const verdict: Verdict = result.cancelled
    ? 'BLOCKED'
    : result.timedOut
      ? 'FAIL'
      : result.exitCode === 0
        ? 'PASS'
        : 'FAIL';

  const stats = parseTestOutput(output);
  const summaryParts = [`exit ${result.exitCode ?? 'null'}`, `${result.durationMs}ms`];
  if (stats.total !== null) summaryParts.push(`${stats.passed ?? 0}/${stats.total} passed`);
  if (result.timedOut) summaryParts.push('TIMED OUT');

  if (kind === 'test' || kind === 'e2e') {
    recordTestRun({
      taskId: options.taskId ?? null,
      runner: stack.testRunners[0] ?? 'unknown',
      command,
      exitCode: result.exitCode,
      verdict,
      stats,
      durationMs: result.durationMs,
      output,
    });
  }

  return {
    kind: KIND_TO_EVIDENCE[kind],
    label: kind,
    verdict,
    command,
    exitCode: result.exitCode,
    summary: summaryParts.join(' · '),
    output: truncateTail(output, 20_000),
    durationMs: result.durationMs,
  };
}

export interface TestStats {
  passed: number | null;
  failed: number | null;
  total: number | null;
}

/** Best-effort parsing of the common runners. Returns nulls when unknown. */
export function parseTestOutput(output: string): TestStats {
  const vitest = /Tests\s+(?:(\d+)\s+failed[^\n]*?\|\s*)?(\d+)\s+passed(?:[^\n]*?)\((\d+)\)/i.exec(output);
  if (vitest) {
    return {
      failed: vitest[1] ? Number(vitest[1]) : 0,
      passed: Number(vitest[2]),
      total: Number(vitest[3]),
    };
  }

  const jest = /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:\d+\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/i.exec(output);
  if (jest) {
    return {
      failed: jest[1] ? Number(jest[1]) : 0,
      passed: Number(jest[2]),
      total: Number(jest[3]),
    };
  }

  const pytest = /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i.exec(output);
  if (pytest) {
    const passed = Number(pytest[1]);
    const failed = pytest[2] ? Number(pytest[2]) : 0;
    return { passed, failed, total: passed + failed };
  }

  return { passed: null, failed: null, total: null };
}

function recordTestRun(input: {
  taskId: string | null;
  runner: string;
  command: string;
  exitCode: number | null;
  verdict: Verdict;
  stats: TestStats;
  durationMs: number;
  output: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO test_runs (id, task_id, project_id, runner, command, exit_code, verdict, passed, failed, total, duration_ms, output, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('test'),
      input.taskId,
      'default',
      input.runner,
      input.command,
      input.exitCode,
      input.verdict,
      input.stats.passed,
      input.stats.failed,
      input.stats.total,
      input.durationMs,
      truncateTail(input.output, 40_000),
      nowIso(),
    );
}

export interface TestRunRecord {
  id: string;
  taskId: string | null;
  runner: string;
  command: string;
  exitCode: number | null;
  verdict: Verdict;
  passed: number | null;
  failed: number | null;
  total: number | null;
  durationMs: number | null;
  createdAt: string;
}

export function listTestRuns(limit = 50): TestRunRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM test_runs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500));
  return rows.map((row) => ({
    id: String(row.id),
    taskId: row.task_id === null || row.task_id === undefined ? null : String(row.task_id),
    runner: String(row.runner),
    command: String(row.command),
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    verdict: String(row.verdict) as Verdict,
    passed: row.passed === null || row.passed === undefined ? null : Number(row.passed),
    failed: row.failed === null || row.failed === undefined ? null : Number(row.failed),
    total: row.total === null || row.total === undefined ? null : Number(row.total),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    createdAt: String(row.created_at),
  }));
}

/** Run the full verification suite in the order that fails fastest first. */
export async function runVerificationSuite(
  kinds: CheckKind[],
  options: CheckOptions = {},
): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  for (const kind of kinds) {
    evidence.push(await runCheck(kind, options));
  }
  return evidence;
}
