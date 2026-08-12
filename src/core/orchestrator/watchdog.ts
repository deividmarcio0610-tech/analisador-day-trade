import { getDb, asText } from '@/core/db/database';
import { cancelJob, emit, isJobActive, lastEventAt, listJobs, setJobState } from './job-store';
import { logger } from '@/core/logging/logger';
import { nowIso } from '@/core/util/id';

/**
 * WATCHDOG
 *
 * A job that stops producing events is not progressing, whatever its row says.
 * The sweep cancels it, records why, and marks it BLOCKED with evidence — it
 * never leaves a spinner running forever and never retries in a loop.
 */

/** A council round on a slow local model can legitimately take a while. */
export const DEFAULT_MAX_IDLE_MS = 15 * 60_000;

export interface StalledJob {
  jobId: string;
  state: string;
  idleMs: number;
  lastEventAt: string | null;
}

const ACTIVE_STATES = ['QUEUED', 'RUNNING', 'WAITING_REVIEW', 'TESTING'];

export function findStalledJobs(maxIdleMs = DEFAULT_MAX_IDLE_MS): StalledJob[] {
  const rows = getDb()
    .prepare(
      `SELECT id, state FROM tasks WHERE state IN (${ACTIVE_STATES.map(() => '?').join(', ')})`,
    )
    .all(...ACTIVE_STATES);

  const now = Date.now();
  const stalled: StalledJob[] = [];

  for (const row of rows) {
    const jobId = asText(row.id);
    const last = lastEventAt(jobId);
    const reference = last ? Date.parse(last) : now;
    const idleMs = now - reference;
    if (idleMs >= maxIdleMs) {
      stalled.push({ jobId, state: asText(row.state), idleMs, lastEventAt: last });
    }
  }
  return stalled;
}

/**
 * Cancel and mark every stalled job. Returns what it acted on so the caller can
 * report it rather than have it happen silently.
 */
export function sweepStalledJobs(maxIdleMs = DEFAULT_MAX_IDLE_MS): StalledJob[] {
  const stalled = findStalledJobs(maxIdleMs);
  for (const job of stalled) {
    const minutes = Math.round(job.idleMs / 60_000);
    const message =
      `Watchdog: no progress for ${minutes} minute(s) (last event ${job.lastEventAt ?? 'never'}). ` +
      'The operation was cancelled and the job marked BLOCKED.';

    // Abort the in-flight work when this process still owns it.
    const cancelled = isJobActive(job.jobId) ? cancelJob(job.jobId) : false;
    emit(job.jobId, 'log', { level: 'ERROR', message });
    emit(job.jobId, 'job.error', { message, blocked: true, watchdog: true, cancelled });
    setJobState(job.jobId, 'BLOCKED', message);
    logger.warn('watchdog', message, { taskId: job.jobId, data: { idleMs: job.idleMs, cancelled } });
  }
  return stalled;
}

export interface WatchdogReport {
  checkedAt: string;
  activeJobs: number;
  stalled: StalledJob[];
  maxIdleMs: number;
}

export function watchdogReport(maxIdleMs = DEFAULT_MAX_IDLE_MS): WatchdogReport {
  const active = listJobs(100).filter((job) => ACTIVE_STATES.includes(job.state));
  return {
    checkedAt: nowIso(),
    activeJobs: active.length,
    stalled: findStalledJobs(maxIdleMs),
    maxIdleMs,
  };
}
