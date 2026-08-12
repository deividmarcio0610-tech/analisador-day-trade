import type {
  EvidenceItem,
  Job,
  JudgeReport,
  PatchOperation,
  ReviewResult,
  TimelineStage,
  TimelineState,
} from '@/core/types';
import { profileFor } from './modes';
import { emit, registerController, releaseController, setJobState } from './job-store';
import { buildContext, renderContext } from '@/core/context/context-engine';
import { memoryDigest, recordFailure } from '@/core/memory/memory';
import {
  runArchitect,
  runBuilder,
  runDebugAnalysis,
  runPlanner,
  runReviewer,
  AgentOutputError,
} from '@/core/agents/council';
import { AgentUnavailableError } from '@/core/agents/agent-runtime';
import { judge } from '@/core/agents/judge';
import { previewPatch, renderPatchForReview, storePatch, applyPatch } from './patch-service';
import { runVerificationSuite, type CheckKind } from '@/core/tools/verification';
import { getOrchestratorConfig } from '@/core/config/config';
import { logger } from '@/core/logging/logger';
import { renderImpact } from '@/core/context/impact';

/**
 * ORCHESTRATOR
 *
 * Planner → Builder → Reviewer → Revision → Tests → Judge → Evidence → Result.
 *
 * Every stage publishes an event so the UI can follow it live, and every claim
 * the result makes is backed by something that actually ran.
 */

export interface RunRequest {
  job: Job;
  focusFiles?: string[];
  /** Apply the accepted patch and run the verification suite afterwards. */
  applyAndVerify?: boolean;
  checks?: CheckKind[];
}

export interface RunOutcome {
  jobId: string;
  patchId: string | null;
  rounds: number;
  review: ReviewResult | null;
  judgeReport: JudgeReport | null;
  applied: boolean;
  summary: string;
}

function stage(jobId: string, name: TimelineStage, state: TimelineState, detail?: string): void {
  emit(jobId, 'timeline', { stage: name, state, detail: detail ?? null, at: new Date().toISOString() });
}

function say(jobId: string, message: string, level: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  emit(jobId, 'log', { level, message });
}

export async function runOrchestration(request: RunRequest): Promise<RunOutcome> {
  const { job } = request;
  const profile = profileFor(job.mode);
  const config = getOrchestratorConfig();
  const maxRounds = Math.min(profile.maxRounds, config.maxRounds);
  const controller = new AbortController();
  registerController(job.id, controller);

  const outcome: RunOutcome = {
    jobId: job.id,
    patchId: null,
    rounds: 0,
    review: null,
    judgeReport: null,
    applied: false,
    summary: '',
  };

  try {
    setJobState(job.id, 'RUNNING');

    // ---- Context -------------------------------------------------------
    stage(job.id, 'context', 'active');
    const bundle = await buildContext({
      query: job.prompt,
      focusFiles: request.focusFiles,
      budgetChars: profile.contextBudget,
    });
    const contextText = renderContext(bundle);
    stage(
      job.id,
      'context',
      'done',
      `${bundle.files.length} file(s), ${bundle.totalChars}/${bundle.budgetChars} chars`,
    );

    // ---- Analysis (memory) ---------------------------------------------
    stage(job.id, 'analysis', 'active');
    const digest = memoryDigest(job.projectId, job.prompt);
    stage(job.id, 'analysis', 'done', digest ? 'project memory applied' : 'no prior memory');

    const baseContext = [contextText, digest].filter(Boolean).join('\n\n');

    // ---- ARCHITECT mode short-circuits: design, no code -----------------
    if (job.mode === 'ARCHITECT') {
      stage(job.id, 'planning', 'active');
      const design = await runArchitect({
        user: `${baseContext}\n\n# REQUEST\n${job.prompt}`,
        taskId: job.id,
        round: 1,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'planner', delta }),
      });
      emit(job.id, 'plan', {
        summary: design.value.summary,
        requirements: design.value.requirements,
        steps: design.value.implementationOrder.map((title, index) => ({
          id: `S${index + 1}`,
          title,
          detail: '',
          files: [],
        })),
        risks: design.value.risks,
        sections: design.value.sections,
      });
      stage(job.id, 'planning', 'done', `${design.value.sections.length} section(s)`);
      stage(job.id, 'implementation', 'skipped', 'architect mode produces a design, not code');
      const report = judge({ evidence: [], required: [] });
      emit(job.id, 'judge', { ...report });
      outcome.judgeReport = report;
      outcome.summary = design.value.summary;
      setJobState(job.id, 'PASSED');
      return outcome;
    }

    // ---- DEBUG mode: hypothesis board before touching code --------------
    if (job.mode === 'DEBUG') {
      stage(job.id, 'analysis', 'active', 'building hypothesis board');
      const analysis = await runDebugAnalysis({
        user: `${baseContext}\n\n# PROBLEM\n${job.prompt}`,
        taskId: job.id,
        round: 1,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'reviewer', delta }),
      });
      emit(job.id, 'agent.message', { role: 'reviewer', kind: 'debug', payload: analysis.value });
      stage(
        job.id,
        'analysis',
        'done',
        `${analysis.value.hypotheses.length} hypothesis/es, root cause: ${analysis.value.rootCause ?? 'not confirmed'}`,
      );
      if (profile.requireRootCause && !analysis.value.rootCause) {
        say(
          job.id,
          'No confirmed root cause yet — the fix below is provisional and must not be treated as final.',
          'WARNING',
        );
      }
    }

    // ---- Planning -------------------------------------------------------
    let planText = '';
    if (profile.plan) {
      stage(job.id, 'planning', 'active');
      const plan = await runPlanner({
        user: `${baseContext}\n\n# REQUEST\n${job.prompt}`,
        taskId: job.id,
        round: 1,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'planner', delta }),
      });
      emit(job.id, 'plan', { ...plan.value });
      planText = [
        `SUMMARY: ${plan.value.summary}`,
        `REQUIREMENTS:\n${plan.value.requirements
          .map((requirement) => `- ${requirement.id}: ${requirement.statement} (verify: ${requirement.verification})`)
          .join('\n')}`,
        `STEPS:\n${plan.value.steps
          .map((step) => `- ${step.id} ${step.title}: ${step.detail} [${step.files.join(', ')}]`)
          .join('\n')}`,
      ].join('\n\n');
      stage(job.id, 'planning', 'done', `${plan.value.steps.length} step(s)`);
    } else {
      stage(job.id, 'planning', 'skipped', `${job.mode} mode goes straight to implementation`);
    }

    // ---- Build / Review rounds -----------------------------------------
    let operations: PatchOperation[] = [];
    let review: ReviewResult | null = null;
    let round = 0;
    let reviewFeedback = '';

    while (round < maxRounds) {
      round += 1;
      outcome.rounds = round;

      stage(job.id, 'implementation', 'active', `round ${round}/${maxRounds}`);
      const builderPrompt = [
        baseContext,
        planText ? `# PLAN\n${planText}` : '',
        reviewFeedback ? `# REVIEW FEEDBACK TO ADDRESS\n${reviewFeedback}` : '',
        operations.length > 0
          ? `# YOUR PREVIOUS PATCH\n${operations.map((operation) => `${operation.action} ${operation.path}`).join('\n')}`
          : '',
        `# REQUEST\n${job.prompt}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const build = await runBuilder({
        user: builderPrompt,
        taskId: job.id,
        round,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'builder', delta }),
      });

      operations = build.value.operations;
      if (operations.length === 0) {
        stage(job.id, 'implementation', 'failed', 'builder produced no file operations');
        say(job.id, `Builder returned no operations: ${build.value.summary}`, 'WARNING');
        setJobState(job.id, 'FAILED', 'Builder produced no file operations');
        outcome.summary = build.value.summary;
        return outcome;
      }

      const stored = storePatch({
        taskId: job.id,
        round,
        author: 'builder',
        operations,
      });
      outcome.patchId = stored.id;

      const preview = await previewPatch(operations);
      emit(job.id, 'patch', {
        patchId: stored.id,
        round,
        summary: build.value.summary,
        notes: build.value.notes,
        additions: preview.additions,
        deletions: preview.deletions,
        files: preview.diffs.map((diff) => ({
          path: diff.path,
          additions: diff.stats.additions,
          deletions: diff.stats.deletions,
          patch: diff.text,
        })),
        impact: renderImpact(preview.impact),
      });
      stage(
        job.id,
        'implementation',
        'done',
        `${operations.length} file(s), +${preview.additions}/-${preview.deletions}`,
      );

      // ---- Review ------------------------------------------------------
      stage(job.id, 'review', 'active', `round ${round}`);
      setJobState(job.id, 'WAITING_REVIEW');
      const patchText = await renderPatchForReview(operations);
      const reviewResult = await runReviewer({
        user: [
          baseContext,
          planText ? `# PLAN\n${planText}` : '',
          `# REQUEST\n${job.prompt}`,
          `# PATCH UNDER REVIEW\n\`\`\`diff\n${patchText}\n\`\`\``,
        ]
          .filter(Boolean)
          .join('\n\n'),
        taskId: job.id,
        round,
        challenge: profile.challengeReview,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'reviewer', delta }),
      });

      review = {
        decision: reviewResult.value.decision,
        findings: reviewResult.value.findings.map((finding, index) => ({
          ...finding,
          id: finding.id || `F${index + 1}`,
        })),
        raw: reviewResult.raw,
      };
      outcome.review = review;
      emit(job.id, 'review', {
        round,
        decision: review.decision,
        findings: review.findings,
      });

      const blockers = review.findings.filter((finding) => finding.severity === 'blocker');
      stage(
        job.id,
        'review',
        review.decision === 'REJECTED' ? 'failed' : 'done',
        `${review.decision} · ${review.findings.length} finding(s), ${blockers.length} blocker(s)`,
      );

      if (review.decision !== 'REJECTED' && blockers.length === 0) break;

      if (round >= maxRounds) {
        say(job.id, `Review still rejecting after ${maxRounds} round(s).`, 'WARNING');
        recordFailure({
          projectId: job.projectId,
          problem: job.prompt,
          attempt: `builder patch round ${round}`,
          result: `reviewer decision ${review.decision}`,
          cause: blockers.map((finding) => finding.summary).join('; ') || 'reviewer rejected',
          validSolution: null,
          test: blockers.find((finding) => finding.suggestedTest)?.suggestedTest ?? null,
        });
        break;
      }

      reviewFeedback = review.findings
        .map((finding) => `- [${finding.severity}/${finding.category}] ${finding.file ?? ''} ${finding.summary}: ${finding.detail}`)
        .join('\n');
      setJobState(job.id, 'RUNNING');
    }

    // ---- Tests + Judge --------------------------------------------------
    let evidence: EvidenceItem[] = [];
    const shouldApply = request.applyAndVerify ?? config.autoApplyPatches;

    if (shouldApply && outcome.patchId) {
      const applied = await applyPatch(outcome.patchId);
      outcome.applied = applied.errors.length === 0;
      emit(job.id, 'evidence', {
        kind: 'git',
        label: 'apply patch',
        verdict: outcome.applied ? 'PASS' : 'FAIL',
        summary: `${applied.written.length} written, ${applied.removed.length} removed, checkpoint ${applied.checkpoint ?? 'none'}`,
      });
      if (!outcome.applied) {
        say(job.id, `Patch application errors: ${applied.errors.map((error) => `${error.path}: ${error.error}`).join('; ')}`, 'ERROR');
      }
    }

    if (outcome.applied && config.runTestsAutomatically) {
      stage(job.id, 'tests', 'active');
      setJobState(job.id, 'TESTING');
      const checks = request.checks ?? (['lint', 'typecheck', 'test', 'build'] as CheckKind[]);
      evidence = await runVerificationSuite(checks, { taskId: job.id, signal: controller.signal });
      for (const item of evidence) emit(job.id, 'evidence', { ...item, output: undefined });
      stage(
        job.id,
        'tests',
        evidence.some((item) => item.verdict === 'FAIL') ? 'failed' : 'done',
        evidence.map((item) => `${item.label}:${item.verdict}`).join(' '),
      );
    } else {
      stage(
        job.id,
        'tests',
        'skipped',
        outcome.applied
          ? 'automatic verification disabled in settings'
          : 'patch not applied — checks cannot run against it',
      );
    }

    stage(job.id, 'validation', 'active');
    const report = judge({
      evidence,
      review,
      required: outcome.applied ? ['build', 'test'] : [],
    });
    outcome.judgeReport = report;
    emit(job.id, 'judge', { ...report, evidence: report.evidence.map((item) => ({ ...item, output: undefined })) });
    stage(job.id, 'validation', report.verdict === 'FAIL' ? 'failed' : 'done', report.verdict);

    const finalState =
      report.verdict === 'PASS'
        ? 'PASSED'
        : report.verdict === 'FAIL'
          ? 'FAILED'
          : 'WAITING_REVIEW';
    setJobState(job.id, finalState);

    outcome.summary = [
      `verdict ${report.verdict} (score ${report.score})`,
      `rounds ${outcome.rounds}`,
      outcome.applied ? 'patch applied' : 'patch pending approval',
    ].join(' · ');
    emit(job.id, 'job.done', { summary: outcome.summary, verdict: report.verdict });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blocked = error instanceof AgentUnavailableError;
    logger.error('orchestrator', message, { taskId: job.id });
    emit(job.id, 'job.error', { message, blocked });
    if (error instanceof AgentOutputError) {
      recordFailure({
        projectId: job.projectId,
        problem: job.prompt,
        attempt: `agent ${error.role} structured output`,
        result: error.detail,
        cause: 'model did not return valid JSON twice in a row',
        validSolution: null,
        test: null,
      });
    }
    setJobState(job.id, blocked ? 'BLOCKED' : 'FAILED', message);
    outcome.summary = message;
    return outcome;
  } finally {
    releaseController(job.id);
  }
}
