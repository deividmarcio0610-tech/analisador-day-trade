import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { CommandRisk, ProcessResult } from '@/core/types';
import { classifyCommand, requiresConfirmation } from '@/core/safety/command-safety';
import { workspaceRoot, resolveInside } from '@/core/paths';
import { logger } from '@/core/logging/logger';
import { newId, nowIso } from '@/core/util/id';
import { singleton } from '@/core/util/singleton';
import { getDb } from '@/core/db/database';

/**
 * TERMINAL
 *
 * Real process execution on the host running the Vision agent. Output is
 * captured verbatim; nothing is synthesised. Processes are cancellable and
 * every CRITICAL command is refused unless the caller confirmed it.
 */

export interface RunOptions {
  /** Full command line, executed through the platform shell. */
  commandLine: string;
  /** Working directory, relative to the workspace root or absolute inside it. */
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Must be true for commands classified CRITICAL. */
  confirmed?: boolean;
  maxOutputChars?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Correlates the process with a task in the logs. */
  taskId?: string;
}

export interface RunningProcess {
  id: string;
  commandLine: string;
  cwd: string;
  risk: CommandRisk;
  startedAt: string;
  taskId?: string;
}

export class CommandBlockedError extends Error {
  constructor(readonly commandLine: string, readonly reasons: string[]) {
    super(
      `Command blocked (CRITICAL): ${commandLine}. Reasons: ${reasons.join(', ')}. ` +
        'Re-run with explicit confirmation to proceed.',
    );
    this.name = 'CommandBlockedError';
  }
}

interface ProcessEntry {
  info: RunningProcess;
  child: ChildProcessWithoutNullStreams;
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_OUTPUT = 2_000_000;

function registry(): Map<string, ProcessEntry> {
  return singleton('process-registry', () => new Map<string, ProcessEntry>());
}

export function processEvents(): EventEmitter {
  return singleton('process-events', () => new EventEmitter().setMaxListeners(0));
}

export function listRunningProcesses(): RunningProcess[] {
  return [...registry().values()].map((entry) => entry.info);
}

export function cancelProcess(id: string): boolean {
  const entry = registry().get(id);
  if (!entry) return false;
  entry.child.kill('SIGTERM');
  setTimeout(() => {
    if (registry().has(id)) entry.child.kill('SIGKILL');
  }, 3_000);
  return true;
}

function shellFor(): { file: string; flag: string } {
  if (process.platform === 'win32') return { file: process.env.COMSPEC ?? 'cmd.exe', flag: '/d/s/c' };
  return { file: process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/sh', flag: '-c' };
}

export async function runCommand(options: RunOptions): Promise<ProcessResult> {
  const root = workspaceRoot();
  const cwd = options.cwd ? resolveInside(root, options.cwd) : root;
  const verdict = classifyCommand(options.commandLine);

  if (requiresConfirmation(verdict.risk) && !options.confirmed) {
    audit('agent', 'command.blocked', options.commandLine, verdict.risk, verdict.reasons.join('; '));
    throw new CommandBlockedError(options.commandLine, verdict.reasons);
  }
  audit(
    options.confirmed ? 'user-confirmed' : 'agent',
    'command.run',
    options.commandLine,
    verdict.risk,
    verdict.reasons.join('; '),
  );

  const id = newId('proc');
  const shell = shellFor();
  const startedAt = nowIso();
  const startedMs = Date.now();
  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;

  logger.process('terminal', `run: ${options.commandLine}`, {
    processId: id,
    taskId: options.taskId,
    data: { cwd, risk: verdict.risk },
  });

  const child = spawn(shell.file, [shell.flag, options.commandLine], {
    cwd,
    env: { ...process.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const info: RunningProcess = {
    id,
    commandLine: options.commandLine,
    cwd,
    risk: verdict.risk,
    startedAt,
    taskId: options.taskId,
  };
  registry().set(id, { info, child });
  processEvents().emit('start', info);

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let cancelled = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3_000);
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const onAbort = () => {
    cancelled = true;
    child.kill('SIGTERM');
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (stdout.length < maxOutput) stdout += chunk;
    options.onStdout?.(chunk);
    processEvents().emit('data', { processId: id, stream: 'stdout', chunk });
  });
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < maxOutput) stderr += chunk;
    options.onStderr?.(chunk);
    processEvents().emit('data', { processId: id, stream: 'stderr', chunk });
  });

  const result = await new Promise<ProcessResult>((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      registry().delete(id);
      options.signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to start "${options.commandLine}": ${error.message}`));
    });
    child.on('close', (code, signalName) => {
      clearTimeout(timer);
      registry().delete(id);
      options.signal?.removeEventListener('abort', onAbort);
      const finishedAt = nowIso();
      resolve({
        command: shell.file,
        args: [shell.flag, options.commandLine],
        cwd,
        stdout,
        stderr,
        exitCode: code,
        signal: signalName,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        timedOut,
        cancelled,
      });
    });
  });

  processEvents().emit('end', { processId: id, exitCode: result.exitCode });
  logger.process(
    'terminal',
    `exit ${result.exitCode ?? 'null'} in ${result.durationMs}ms: ${options.commandLine}`,
    { processId: id, taskId: options.taskId, data: { timedOut, cancelled } },
  );
  return result;
}

function audit(
  actor: string,
  action: string,
  target: string,
  risk: CommandRisk,
  detail: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO audit_logs (actor, action, target, risk, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(actor, action, target, risk, detail, nowIso());
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string;
  risk: string;
  detail: string | null;
  createdAt: string;
}

export function listAuditLogs(limit = 100): AuditEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 1000));
  return rows.map((row) => ({
    id: Number(row.id),
    actor: String(row.actor),
    action: String(row.action),
    target: String(row.target),
    risk: String(row.risk),
    detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
    createdAt: String(row.created_at),
  }));
}
