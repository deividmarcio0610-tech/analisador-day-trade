import type { Job, RunMode } from '@/core/types';
import { createJob, emit, eventsSince, getJob, setJobState } from './job-store';
import { runOrchestration, type ResumeState } from './orchestrator';
import { listPatches } from './patch-service';
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

/**
 * CRASH RECOVERY
 *
 * Rebuilds what an interrupted run already produced from its persisted events
 * and stored patches, so a resume pays only for the stages that never finished.
 * Nothing is inferred: if an output was not persisted, it is simply redone.
 */
export function recoverState(jobId: string): ResumeState | null {
  const events = eventsSince(jobId, 0);
  if (events.length === 0) return null;

  let planText = '';
  let reviewFeedback = '';
  let round = 1;

  for (const event of events) {
    if (event.type === 'plan') {
      const plan = event.payload as {
        summary?: string;
        requirements?: Array<{ id: string; statement: string; verification: string }>;
        steps?: Array<{ id: string; title: string; detail: string; files: string[] }>;
      };
      planText = [
        `SUMMARY: ${plan.summary ?? ''}`,
        `REQUIREMENTS:\n${(plan.requirements ?? [])
          .map((requirement) => `- ${requirement.id}: ${requirement.statement} (verify: ${requirement.verification})`)
          .join('\n')}`,
        `STEPS:\n${(plan.steps ?? [])
          .map((step) => `- ${step.id} ${step.title}: ${step.detail} [${step.files.join(', ')}]`)
          .join('\n')}`,
      ].join('\n\n');
    } else if (event.type === 'review') {
      const payload = event.payload as {
        round?: number;
        findings?: Array<{ severity: string; category: string; file?: string; summary: string; detail: string }>;
      };
      reviewFeedback = (payload.findings ?? [])
        .map((finding) => `- [${finding.severity}/${finding.category}] ${finding.file ?? ''} ${finding.summary}: ${finding.detail}`)
        .join('\n');
      round = Math.max(round, (payload.round ?? 1) + 1);
    } else if (event.type === 'patch') {
      const payload = event.payload as { round?: number };
      round = Math.max(round, payload.round ?? 1);
    }
  }

  const patches = listPatches(jobId);
  const latest = patches[0] ?? null;

  return {
    planText,
    operations: latest?.operations ?? [],
    patchId: latest?.id ?? null,
    reviewFeedback,
    round,
  };
}

/** Continue an interrupted job instead of paying for it again. */
export function resumeJob(jobId: string): { job: Job; resumed: boolean; reason: string } {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.state !== 'INTERRUPTED') {
    return { job, resumed: false, reason: `Job is ${job.state}, only INTERRUPTED jobs can be resumed` };
  }

  const blocked = [roleUnavailableReason('builder'), roleUnavailableReason('reviewer')].filter(
    (reason): reason is string => reason !== null,
  );
  if (blocked.length > 0) {
    const message = [...new Set(blocked)].join(' · ');
    emit(job.id, 'job.error', { message, blocked: true });
    setJobState(job.id, 'BLOCKED', message);
    return { job, resumed: false, reason: message };
  }

  const resume = recoverState(jobId) ?? undefined;
  emit(job.id, 'log', {
    level: 'INFO',
    message: resume
      ? `Resuming: ${resume.operations.length} file operation(s) and ${resume.planText ? 'a plan' : 'no plan'} recovered.`
      : 'Resuming from the beginning: nothing had been persisted yet.',
  });

  const run = profileFor(job.mode).tournament
    ? runTournament({ job })
    : runOrchestration({ job, resume });

  void run.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('runner', `resumed job ${job.id} crashed: ${message}`, { taskId: job.id });
    emit(job.id, 'job.error', { message });
    setJobState(job.id, 'FAILED', message);
  });

  return { job, resumed: true, reason: 'resumed' };
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
