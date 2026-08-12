import type { Job, RunMode } from '@/core/types';
import { createJob, emit, setJobState } from './job-store';
import { runOrchestration } from './orchestrator';
import { runTournament } from './tournament';
import { profileFor } from './modes';
import { currentProject } from '@/core/db/project-repo';
import { getOrchestratorConfig } from '@/core/config/config';
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
