import { getDb, asNumber, asText, asTextOrNull, parseJson } from '@/core/db/database';
import { nowIso } from '@/core/util/id';
import type { LogLevel } from '@/core/types';

/**
 * Structured logging. Every entry can be correlated to a project, task, agent
 * and process, which is what the Logs panel filters on.
 */

export interface LogContext {
  projectId?: string;
  taskId?: string;
  agent?: string;
  processId?: string;
  data?: unknown;
}

export interface LogEntry extends LogContext {
  id: number;
  level: LogLevel;
  scope: string;
  message: string;
  createdAt: string;
}

const MAX_LOG_ROWS = 20_000;
let writesSinceTrim = 0;

export function log(
  level: LogLevel,
  scope: string,
  message: string,
  context: LogContext = {},
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO logs (level, scope, message, project_id, task_id, agent, process_id, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    level,
    scope,
    message,
    context.projectId ?? null,
    context.taskId ?? null,
    context.agent ?? null,
    context.processId ?? null,
    context.data === undefined ? null : JSON.stringify(context.data),
    nowIso(),
  );

  writesSinceTrim += 1;
  if (writesSinceTrim >= 500) {
    writesSinceTrim = 0;
    db.prepare(
      `DELETE FROM logs WHERE id < (SELECT MAX(id) - ? FROM logs)`,
    ).run(MAX_LOG_ROWS);
  }
}

export const logger = {
  info: (scope: string, message: string, context?: LogContext) =>
    log('INFO', scope, message, context),
  success: (scope: string, message: string, context?: LogContext) =>
    log('SUCCESS', scope, message, context),
  warn: (scope: string, message: string, context?: LogContext) =>
    log('WARNING', scope, message, context),
  error: (scope: string, message: string, context?: LogContext) =>
    log('ERROR', scope, message, context),
  debug: (scope: string, message: string, context?: LogContext) =>
    log('DEBUG', scope, message, context),
  agent: (scope: string, message: string, context?: LogContext) =>
    log('AGENT', scope, message, context),
  process: (scope: string, message: string, context?: LogContext) =>
    log('PROCESS', scope, message, context),
};

export interface LogQuery {
  levels?: LogLevel[];
  taskId?: string;
  projectId?: string;
  search?: string;
  limit?: number;
  afterId?: number;
}

export function queryLogs(query: LogQuery = {}): LogEntry[] {
  const db = getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (query.levels && query.levels.length > 0) {
    where.push(`level IN (${query.levels.map(() => '?').join(', ')})`);
    params.push(...query.levels);
  }
  if (query.taskId) {
    where.push('task_id = ?');
    params.push(query.taskId);
  }
  if (query.projectId) {
    where.push('project_id = ?');
    params.push(query.projectId);
  }
  if (query.search) {
    where.push('(message LIKE ? OR scope LIKE ?)');
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  if (query.afterId !== undefined) {
    where.push('id > ?');
    params.push(query.afterId);
  }

  const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
  const sql = `SELECT * FROM logs ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY id DESC LIMIT ?`;

  const rows = db.prepare(sql).all(...params, limit);
  return rows.map(toEntry).reverse();
}

function toEntry(row: Record<string, unknown>): LogEntry {
  return {
    id: asNumber(row.id),
    level: asText(row.level) as LogLevel,
    scope: asText(row.scope),
    message: asText(row.message),
    projectId: asTextOrNull(row.project_id) ?? undefined,
    taskId: asTextOrNull(row.task_id) ?? undefined,
    agent: asTextOrNull(row.agent) ?? undefined,
    processId: asTextOrNull(row.process_id) ?? undefined,
    data: parseJson<unknown>(row.data, null),
    createdAt: asText(row.created_at),
  };
}
