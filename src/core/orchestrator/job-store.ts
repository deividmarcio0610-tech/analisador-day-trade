import { EventEmitter } from 'node:events';
import { getDb, asNumber, asText, asTextOrNull, parseJson } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import { singleton } from '@/core/util/singleton';
import type { Job, JobEvent, JobEventType, JobState, RunMode } from '@/core/types';

/**
 * JOBS
 *
 * Every long running operation is a job. Events are persisted before they are
 * emitted, so a browser that reloads mid-run replays the full history from
 * SQLite and then continues on the live stream — no lost progress.
 */

function bus(): EventEmitter {
  return singleton('job-bus', () => new EventEmitter().setMaxListeners(0));
}

function controllers(): Map<string, AbortController> {
  return singleton('job-controllers', () => new Map<string, AbortController>());
}

export function createJob(input: {
  projectId: string;
  mode: RunMode;
  command: string;
  prompt: string;
}): Job {
  const job: Job = {
    id: newId('job'),
    projectId: input.projectId,
    mode: input.mode,
    command: input.command,
    prompt: input.prompt,
    state: 'QUEUED',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
  };
  getDb()
    .prepare(
      `INSERT INTO tasks (id, project_id, mode, command, prompt, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(job.id, job.projectId, job.mode, job.command, job.prompt, job.state, job.createdAt);
  emit(job.id, 'job.created', { id: job.id, mode: job.mode, command: job.command });
  return job;
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? toJob(row) : null;
}

export function listJobs(limit = 50, projectId?: string): Job[] {
  const db = getDb();
  const rows = projectId
    ? db
        .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(projectId, limit)
    : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(toJob);
}

export function setJobState(id: string, state: JobState, error?: string | null): void {
  const db = getDb();
  const now = nowIso();
  if (state === 'RUNNING') {
    db.prepare('UPDATE tasks SET state = ?, started_at = COALESCE(started_at, ?) WHERE id = ?').run(
      state,
      now,
      id,
    );
  } else if (isTerminal(state)) {
    db.prepare('UPDATE tasks SET state = ?, finished_at = ?, error = ? WHERE id = ?').run(
      state,
      now,
      error ?? null,
      id,
    );
  } else {
    db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run(state, id);
  }
  emit(id, 'job.state', { state, error: error ?? null });
}

export function isTerminal(state: JobState): boolean {
  return state === 'PASSED' || state === 'FAILED' || state === 'CANCELLED' || state === 'BLOCKED';
}

export function emit(jobId: string, type: JobEventType, payload: unknown): JobEvent {
  const at = nowIso();
  const info = getDb()
    .prepare('INSERT INTO job_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(jobId, type, JSON.stringify(payload), at);
  const event: JobEvent = {
    id: Number(info.lastInsertRowid),
    jobId,
    type,
    at,
    payload,
  };
  bus().emit(jobId, event);
  return event;
}

export function eventsSince(jobId: string, afterId = 0): JobEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM job_events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT 5000')
    .all(jobId, afterId);
  return rows.map((row) => ({
    id: asNumber(row.id),
    jobId: asText(row.task_id),
    type: asText(row.type) as JobEventType,
    at: asText(row.created_at),
    payload: parseJson<unknown>(row.payload, null),
  }));
}

export function subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
  bus().on(jobId, listener);
  return () => {
    bus().off(jobId, listener);
  };
}

export function registerController(jobId: string, controller: AbortController): void {
  controllers().set(jobId, controller);
}

export function cancelJob(jobId: string): boolean {
  const controller = controllers().get(jobId);
  if (!controller) return false;
  controller.abort(new Error('Cancelled by user'));
  controllers().delete(jobId);
  return true;
}

export function releaseController(jobId: string): void {
  controllers().delete(jobId);
}

export function isJobActive(jobId: string): boolean {
  return controllers().has(jobId);
}

function toJob(row: Record<string, unknown>): Job {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    mode: asText(row.mode) as RunMode,
    command: asText(row.command),
    prompt: asText(row.prompt),
    state: asText(row.state) as JobState,
    createdAt: asText(row.created_at),
    startedAt: asTextOrNull(row.started_at),
    finishedAt: asTextOrNull(row.finished_at),
    error: asTextOrNull(row.error),
  };
}

/**
 * Jobs that were RUNNING when the server stopped can never resume, so mark them
 * as failed on boot instead of leaving a permanently spinning row in the UI.
 */
export function reconcileOrphanJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE tasks SET state = 'FAILED', finished_at = ?, error = 'Interrupted by server restart'
       WHERE state IN ('RUNNING', 'QUEUED', 'WAITING_REVIEW', 'TESTING')`,
    )
    .run(nowIso());
  return Number(info.changes);
}
