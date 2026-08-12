import type { HealthStatus } from '@/core/types';
import { getAgentConfig } from '@/core/config/config';
import { runBuilder, runReviewer, AgentOutputError } from '@/core/agents/council';
import { AgentUnavailableError } from '@/core/agents/agent-runtime';
import { verifyRole, roleUnavailableReason, modelsMatch } from './ai-health';
import { statusForFailure } from './failure';
import { newId } from '@/core/util/id';
import { logger } from '@/core/logging/logger';

/**
 * FUNCTIONAL PIPELINE CHECK
 *
 * Proves the council can actually work end to end against the configured
 * endpoint: the builder is asked for a small, complete patch, and its real
 * output is handed to the reviewer. Each stage is only PASS when the content is
 * usable — a 200 with unusable output fails, as it should.
 */

export interface PipelineStage {
  name: 'builder-reachable' | 'reviewer-reachable' | 'builder-task' | 'reviewer-review';
  label: string;
  status: HealthStatus;
  detail: string;
  durationMs: number | null;
  model: string | null;
  reportedModel: string | null;
  sample: string | null;
}

export interface PipelineCheckResult {
  ok: boolean;
  stages: PipelineStage[];
  startedAt: string;
  finishedAt: string;
  /** Task id used so the run appears in the logs and the router statistics. */
  taskId: string;
}

const TASK = [
  'Create a single TypeScript file `src/vision-selftest.ts` exporting:',
  '',
  '  export function addNumbers(a: number, b: number): number',
  '',
  'It must return the sum. Return the full file content.',
].join('\n');

export async function runPipelineCheck(
  options: { signal?: AbortSignal } = {},
): Promise<PipelineCheckResult> {
  const startedAt = new Date().toISOString();
  const taskId = newId('selftest');
  const stages: PipelineStage[] = [];

  // ---- Stage 1 and 2: can each role be reached and does the model answer? ----
  for (const role of ['builder', 'reviewer'] as const) {
    const blocked = roleUnavailableReason(role);
    if (blocked) {
      stages.push({
        name: role === 'builder' ? 'builder-reachable' : 'reviewer-reachable',
        label: `${role} endpoint`,
        status: 'NOT_CONFIGURED',
        detail: blocked,
        durationMs: null,
        model: getAgentConfig(role).model || null,
        reportedModel: null,
        sample: null,
      });
      continue;
    }
    const verification = await verifyRole(role, { signal: options.signal });
    stages.push({
      name: role === 'builder' ? 'builder-reachable' : 'reviewer-reachable',
      label: `${role} endpoint`,
      status: verification.status,
      detail: verification.detail,
      durationMs: verification.latencyMs,
      model: verification.model || null,
      reportedModel: verification.reportedModel,
      sample: verification.sample,
    });
  }

  const reachable = stages.every((stage) => stage.status === 'ONLINE');
  if (!reachable) {
    return finish(stages, startedAt, taskId);
  }

  // ---- Stage 3: the builder produces a real patch ----------------------------
  const builderConfig = getAgentConfig('builder');
  let patchSummary = '';
  let patchText = '';
  const builderStartedAt = Date.now();

  try {
    const build = await runBuilder({
      user: `${TASK}\n\nThere is no existing code to reuse. Produce the file.`,
      taskId,
      round: 1,
      // A connection test must reach the model. An answer served from cache
      // would prove the cache works, not that the endpoint does.
      useCache: false,
      signal: options.signal,
    });

    const operations = build.value.operations;
    const created = operations[0];
    patchSummary = build.value.summary;
    patchText = created?.content ?? '';

    const usable = operations.length > 0 && typeof created?.content === 'string' && patchText.includes('addNumbers');
    stages.push({
      name: 'builder-task',
      label: 'builder produced a patch',
      status: usable ? 'ONLINE' : 'ERROR',
      detail: usable
        ? `${operations.length} operation(s); ${created?.path ?? 'unknown path'} contains the requested function`
        : `The builder answered but the patch is unusable (${operations.length} operation(s), function not found)`,
      durationMs: Date.now() - builderStartedAt,
      model: builderConfig.model,
      reportedModel: null,
      sample: patchText.slice(0, 200) || build.value.summary.slice(0, 200),
    });

    if (!usable) return finish(stages, startedAt, taskId);
  } catch (error) {
    stages.push(failureStage('builder-task', 'builder produced a patch', error, builderConfig.model, builderStartedAt));
    return finish(stages, startedAt, taskId);
  }

  // ---- Stage 4: the reviewer reviews that real output ------------------------
  const reviewerConfig = getAgentConfig('reviewer');
  const reviewerStartedAt = Date.now();
  try {
    const review = await runReviewer({
      user: [
        '# TASK GIVEN TO THE BUILDER',
        TASK,
        '',
        '# BUILDER SUMMARY',
        patchSummary,
        '',
        '# PATCH UNDER REVIEW',
        '```ts',
        patchText,
        '```',
      ].join('\n'),
      taskId,
      round: 1,
      useCache: false,
      signal: options.signal,
    });

    const decision = review.value.decision;
    stages.push({
      name: 'reviewer-review',
      label: 'reviewer returned a decision',
      status: 'ONLINE',
      detail: `${decision} with ${review.value.findings.length} finding(s)`,
      durationMs: Date.now() - reviewerStartedAt,
      model: reviewerConfig.model,
      reportedModel: null,
      sample: review.raw.slice(0, 200),
    });
  } catch (error) {
    stages.push(
      failureStage('reviewer-review', 'reviewer returned a decision', error, reviewerConfig.model, reviewerStartedAt),
    );
  }

  return finish(stages, startedAt, taskId);
}

function failureStage(
  name: PipelineStage['name'],
  label: string,
  error: unknown,
  model: string,
  startedAt: number,
): PipelineStage {
  const status: HealthStatus =
    error instanceof AgentUnavailableError
      ? 'NOT_CONFIGURED'
      : error instanceof AgentOutputError
        ? 'ERROR'
        : statusForFailure(error);
  return {
    name,
    label,
    status,
    detail: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - startedAt,
    model,
    reportedModel: null,
    sample: error instanceof AgentOutputError ? error.raw.slice(0, 200) : null,
  };
}

function finish(stages: PipelineStage[], startedAt: string, taskId: string): PipelineCheckResult {
  const ok = stages.length === 4 && stages.every((stage) => stage.status === 'ONLINE');
  logger[ok ? 'success' : 'warn'](
    'pipeline-check',
    ok ? 'builder → reviewer pipeline verified' : 'pipeline check did not complete',
    { taskId, data: { stages: stages.map((stage) => `${stage.name}:${stage.status}`) } },
  );
  return { ok, stages, startedAt, finishedAt: new Date().toISOString(), taskId };
}

export { modelsMatch };
