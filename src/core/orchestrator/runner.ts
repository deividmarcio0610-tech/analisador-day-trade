import type { Job, RunMode } from '@/core/types';
import { createJob, emit, setJobState } from './job-store';
import { runOrchestration } from './orchestrator';
import { runTournament } from './tournament';
import { profileFor } from './modes';
import { currentProject } from '@/core/db/project-repo';
import { getOrchestratorConfig } from '@/core/config/config';
import { roleUnavailableReason } from '@/core/providers/ai-health';
import { logger } from '@/core/logging/logger';
import type { CheckKind } from '@/core/tools/verification';

/**
 * Starts a job and lets it run in the background. The HTTP request returns
 * immediately with the job id; progress is consumed from the event stream, so a
 * reload never loses a running job.
 */

export interface StartJobInput {
  prompt: string;
  command: string;
  mode?: RunMode;
  focusFiles?: string[];
  applyAndVerify?: boolean;
  checks?: CheckKind[];
}

export function startJob(input: StartJobInput): Job {
  const project = currentProject();
  const mode = input.mode ?? getOrchestratorConfig().defaultMode;
  const job = createJob({
    projectId: project.id,
    mode,
    command: input.command,
    prompt: input.prompt,
  });

  const profile = profileFor(mode);

  // Preflight: a council run needs models. When they are not available the job
  // is BLOCKED with the reason instead of failing deep inside an agent turn —
  // and the rest of the platform keeps working.
  const blocked = [roleUnavailableReason('builder'), roleUnavailableReason('reviewer')].filter(
    (reason): reason is string => reason !== null,
  );
  if (blocked.length > 0) {
    const message = [...new Set(blocked)].join(' · ');
    logger.warn('runner', `job ${job.id} blocked: ${message}`, { taskId: job.id });
    emit(job.id, 'log', { level: 'ERROR', message });
    emit(job.id, 'job.error', { message, blocked: true });
    setJobState(job.id, 'BLOCKED', message);
    return job;
  }

  const run = profile.tournament
    ? runTournament({
        job,
        focusFiles: input.focusFiles,
        verify: input.applyAndVerify ?? false,
        checks: input.checks,
      })
    : runOrchestration({
        job,
        focusFiles: input.focusFiles,
        applyAndVerify: input.applyAndVerify,
        checks: input.checks,
      });

  void run.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('runner', `job ${job.id} crashed: ${message}`, { taskId: job.id });
    emit(job.id, 'job.error', { message });
    setJobState(job.id, 'FAILED', message);
  });

  return job;
}
