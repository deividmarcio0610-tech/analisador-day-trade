import { getDb, asNumber, asNumberOrNull, asText, asTextOrNull } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import type { AgentRole } from '@/core/types';

/** History of every model invocation: used by the Model Router statistics view. */

export interface AgentRunRecord {
  id: string;
  taskId: string;
  role: AgentRole;
  provider: string;
  model: string;
  round: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  status: 'running' | 'ok' | 'error';
  error: string | null;
}

export function startAgentRun(input: {
  taskId: string;
  role: AgentRole;
  provider: string;
  model: string;
  round: number;
}): string {
  const id = newId('run');
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, task_id, role, provider, model, round, started_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`,
    )
    .run(id, input.taskId, input.role, input.provider, input.model, input.round, nowIso());
  return id;
}

export function finishAgentRun(
  id: string,
  result: {
    status: 'ok' | 'error';
    durationMs: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    error?: string | null;
  },
): void {
  getDb()
    .prepare(
      `UPDATE agent_runs
       SET finished_at = ?, duration_ms = ?, prompt_tokens = ?, completion_tokens = ?, status = ?, error = ?
       WHERE id = ?`,
    )
    .run(
      nowIso(),
      result.durationMs,
      result.promptTokens ?? null,
      result.completionTokens ?? null,
      result.status,
      result.error ?? null,
      id,
    );
}

export function listAgentRuns(taskId?: string, limit = 100): AgentRunRecord[] {
  const db = getDb();
  const rows = taskId
    ? db
        .prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(taskId, limit)
    : db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(limit);
  return rows.map(toRecord);
}

export interface RouterStat {
  role: AgentRole;
  provider: string;
  model: string;
  runs: number;
  errors: number;
  avgDurationMs: number;
}

export function routerStats(): RouterStat[] {
  const rows = getDb()
    .prepare(
      `SELECT role, provider, model,
              COUNT(*) AS runs,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
              AVG(COALESCE(duration_ms, 0)) AS avg_duration
       FROM agent_runs
       GROUP BY role, provider, model
       ORDER BY runs DESC`,
    )
    .all();
  return rows.map((row) => ({
    role: asText(row.role) as AgentRole,
    provider: asText(row.provider),
    model: asText(row.model),
    runs: asNumber(row.runs),
    errors: asNumber(row.errors),
    avgDurationMs: Math.round(asNumber(row.avg_duration)),
  }));
}

function toRecord(row: Record<string, unknown>): AgentRunRecord {
  return {
    id: asText(row.id),
    taskId: asText(row.task_id),
    role: asText(row.role) as AgentRole,
    provider: asText(row.provider),
    model: asText(row.model),
    round: asNumber(row.round),
    startedAt: asText(row.started_at),
    finishedAt: asTextOrNull(row.finished_at),
    durationMs: asNumberOrNull(row.duration_ms),
    promptTokens: asNumberOrNull(row.prompt_tokens),
    completionTokens: asNumberOrNull(row.completion_tokens),
    status: asText(row.status) as AgentRunRecord['status'],
    error: asTextOrNull(row.error),
  };
}
