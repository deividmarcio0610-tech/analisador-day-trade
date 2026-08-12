import path from 'node:path';
import fs from 'node:fs/promises';
import type { EvidenceItem, Job, PatchOperation, ReviewResult } from '@/core/types';
import { emit, registerController, releaseController, setJobState } from './job-store';
import { buildContext, renderContext } from '@/core/context/context-engine';
import { memoryDigest, recordDecision } from '@/core/memory/memory';
import { runBuilder, runReviewer } from '@/core/agents/council';
import { previewPatch, storePatch, renderPatchForReview } from './patch-service';
import { createWorktree, removeWorktree, listWorktrees } from '@/core/tools/git';
import { runCheck, type CheckKind } from '@/core/tools/verification';
import { judge } from '@/core/agents/judge';
import { profileFor } from './modes';
import { resolveInside, toRelative, workspaceRoot } from '@/core/paths';
import { logger } from '@/core/logging/logger';

/**
 * SOLUTION TOURNAMENT (EXTREME mode)
 *
 * Two candidate patches are produced independently, cross reviewed, and — when
 * verification is requested — applied into separate git worktrees so both can be
 * built and tested without touching the main tree. The winner is chosen from
 * measured results, not from an opinion.
 */

export interface Candidate {
  id: 'A' | 'B';
  author: string;
  patchId: string;
  operations: PatchOperation[];
  summary: string;
  additions: number;
  deletions: number;
  filesTouched: number;
  review: ReviewResult | null;
  evidence: EvidenceItem[];
  score: number;
  worktree: string | null;
}

export interface TournamentResult {
  jobId: string;
  candidates: Candidate[];
  winner: 'A' | 'B' | null;
  rationale: string[];
}

export interface TournamentRequest {
  job: Job;
  focusFiles?: string[];
  verify?: boolean;
  checks?: CheckKind[];
}

export async function runTournament(request: TournamentRequest): Promise<TournamentResult> {
  const { job } = request;
  const profile = profileFor('EXTREME');
  const controller = new AbortController();
  registerController(job.id, controller);

  try {
    setJobState(job.id, 'RUNNING');
    emit(job.id, 'timeline', { stage: 'context', state: 'active' });

    const bundle = await buildContext({
      query: job.prompt,
      focusFiles: request.focusFiles,
      budgetChars: profile.contextBudget,
    });
    const baseContext = [renderContext(bundle), memoryDigest(job.projectId, job.prompt)]
      .filter(Boolean)
      .join('\n\n');
    emit(job.id, 'timeline', { stage: 'context', state: 'done', detail: `${bundle.files.length} file(s)` });

    emit(job.id, 'timeline', { stage: 'implementation', state: 'active', detail: 'two independent solutions' });

    const angles: Array<{ id: 'A' | 'B'; instruction: string }> = [
      {
        id: 'A',
        instruction:
          'Produce the most direct, minimal-change solution that fully solves the request. Favour small blast radius.',
      },
      {
        id: 'B',
        instruction:
          'Produce an independent solution. Do not assume the obvious approach is right: consider a different structure if it removes a class of bugs. Favour correctness and clarity over patch size.',
      },
    ];

    const candidates: Candidate[] = [];
    for (const angle of angles) {
      const build = await runBuilder({
        user: `${baseContext}\n\n# REQUEST\n${job.prompt}\n\n# APPROACH CONSTRAINT (candidate ${angle.id})\n${angle.instruction}`,
        taskId: job.id,
        round: angle.id === 'A' ? 1 : 2,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'builder', candidate: angle.id, delta }),
      });
      if (build.value.operations.length === 0) {
        emit(job.id, 'log', { level: 'WARNING', message: `Candidate ${angle.id} produced no operations` });
        continue;
      }
      const stored = storePatch({
        taskId: job.id,
        round: angle.id === 'A' ? 1 : 2,
        author: `builder:${angle.id}`,
        operations: build.value.operations,
      });
      const preview = await previewPatch(build.value.operations);
      candidates.push({
        id: angle.id,
        author: `builder:${angle.id}`,
        patchId: stored.id,
        operations: build.value.operations,
        summary: build.value.summary,
        additions: preview.additions,
        deletions: preview.deletions,
        filesTouched: build.value.operations.length,
        review: null,
        evidence: [],
        score: 0,
        worktree: null,
      });
      emit(job.id, 'patch', {
        patchId: stored.id,
        candidate: angle.id,
        summary: build.value.summary,
        additions: preview.additions,
        deletions: preview.deletions,
        files: preview.diffs.map((diff) => ({
          path: diff.path,
          additions: diff.stats.additions,
          deletions: diff.stats.deletions,
          patch: diff.text,
        })),
      });
    }

    if (candidates.length === 0) {
      setJobState(job.id, 'FAILED', 'No candidate produced a patch');
      return { jobId: job.id, candidates: [], winner: null, rationale: ['no candidates'] };
    }

    // ---- Cross review --------------------------------------------------
    emit(job.id, 'timeline', { stage: 'review', state: 'active', detail: 'cross review' });
    for (const candidate of candidates) {
      const patchText = await renderPatchForReview(candidate.operations);
      const review = await runReviewer({
        user: `${baseContext}\n\n# REQUEST\n${job.prompt}\n\n# CANDIDATE ${candidate.id} PATCH\n\`\`\`diff\n${patchText}\n\`\`\``,
        taskId: job.id,
        round: candidate.id === 'A' ? 1 : 2,
        challenge: true,
        signal: controller.signal,
        onDelta: (delta) => emit(job.id, 'agent.delta', { role: 'reviewer', candidate: candidate.id, delta }),
      });
      candidate.review = {
        decision: review.value.decision,
        findings: review.value.findings.map((finding, index) => ({
          ...finding,
          id: finding.id || `${candidate.id}-F${index + 1}`,
        })),
        raw: review.raw,
      };
      emit(job.id, 'review', {
        candidate: candidate.id,
        decision: candidate.review.decision,
        findings: candidate.review.findings,
      });
    }
    emit(job.id, 'timeline', { stage: 'review', state: 'done' });

    // ---- Isolated verification ------------------------------------------
    if (request.verify) {
      emit(job.id, 'timeline', { stage: 'tests', state: 'active', detail: 'isolated worktrees' });
      setJobState(job.id, 'TESTING');
      for (const candidate of candidates) {
        const evidence = await verifyInWorktree(job.id, candidate, request.checks ?? ['typecheck', 'test', 'build']);
        candidate.evidence = evidence;
        for (const item of evidence) {
          emit(job.id, 'evidence', { candidate: candidate.id, ...item, output: undefined });
        }
      }
      emit(job.id, 'timeline', { stage: 'tests', state: 'done' });
    } else {
      emit(job.id, 'timeline', {
        stage: 'tests',
        state: 'skipped',
        detail: 'verification not requested — comparison uses review findings and patch metrics only',
      });
    }

    // ---- Decide ----------------------------------------------------------
    emit(job.id, 'timeline', { stage: 'validation', state: 'active' });
    const rationale: string[] = [];
    for (const candidate of candidates) {
      candidate.score = scoreCandidate(candidate);
      rationale.push(
        `Candidate ${candidate.id}: score ${candidate.score} — ` +
          `${candidate.filesTouched} file(s), +${candidate.additions}/-${candidate.deletions}, ` +
          `review ${candidate.review?.decision ?? 'n/a'} (${candidate.review?.findings.length ?? 0} finding(s)), ` +
          `checks ${candidate.evidence.map((item) => `${item.label}:${item.verdict}`).join(' ') || 'not run'}`,
      );
    }

    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    const runnerUp = sorted[1];
    const winner = best && (!runnerUp || best.score > runnerUp.score) ? best.id : null;
    if (!winner) rationale.push('Scores tied: no winner declared, human decision required.');

    if (winner && best) {
      recordDecision({
        projectId: job.projectId,
        decision: `Tournament winner: candidate ${winner} (${best.summary.slice(0, 200)})`,
        alternatives: candidates.filter((c) => c.id !== winner).map((c) => `candidate ${c.id}: ${c.summary.slice(0, 200)}`),
        reason: 'highest evidence-based score in EXTREME tournament',
        evidence: rationale.join('\n'),
        consequences: 'winning patch is the one offered for apply; the other remains stored for comparison',
        });
    }

    const report = judge({
      evidence: best?.evidence ?? [],
      review: best?.review ?? null,
      required: request.verify ? ['build', 'test'] : [],
    });
    emit(job.id, 'judge', { ...report, evidence: report.evidence.map((item) => ({ ...item, output: undefined })) });
    emit(job.id, 'timeline', { stage: 'validation', state: 'done', detail: report.verdict });
    emit(job.id, 'job.done', { winner, rationale });

    setJobState(job.id, report.verdict === 'FAIL' ? 'FAILED' : 'WAITING_REVIEW');
    return { jobId: job.id, candidates, winner, rationale };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(job.id, 'job.error', { message });
    setJobState(job.id, 'FAILED', message);
    return { jobId: job.id, candidates: [], winner: null, rationale: [message] };
  } finally {
    releaseController(job.id);
  }
}

/**
 * A fresh worktree has no installed dependencies. Symlinking the main tree's
 * node_modules makes the candidate buildable without a full reinstall; if the
 * link cannot be created the checks simply fail honestly.
 */
async function linkDependencies(root: string, worktreePath: string): Promise<void> {
  const source = path.join(root, 'node_modules');
  const target = path.join(worktreePath, 'node_modules');
  try {
    await fs.access(source);
  } catch {
    return;
  }
  try {
    await fs.access(target);
    return;
  } catch {
    // not present yet — create the link below
  }
  try {
    await fs.symlink(source, target, 'dir');
  } catch (error) {
    logger.warn('tournament', `could not link node_modules into worktree: ${String(error)}`);
  }
}

function scoreCandidate(candidate: Candidate): number {
  let score = 0;
  const executed = candidate.evidence.filter((item) => item.verdict === 'PASS' || item.verdict === 'FAIL');
  for (const item of executed) {
    const weight = item.kind === 'build' || item.kind === 'test' ? 30 : 15;
    score += item.verdict === 'PASS' ? weight : -weight;
  }
  for (const finding of candidate.review?.findings ?? []) {
    if (finding.severity === 'blocker') score -= 30;
    else if (finding.severity === 'major') score -= 12;
    else if (finding.severity === 'minor') score -= 4;
  }
  if (candidate.review?.decision === 'APPROVED') score += 10;
  if (candidate.review?.decision === 'REJECTED') score -= 20;
  // Smaller patches win ties; the effect is deliberately small.
  score -= Math.min(10, Math.floor((candidate.additions + candidate.deletions) / 200));
  return score;
}

async function verifyInWorktree(
  jobId: string,
  candidate: Candidate,
  checks: CheckKind[],
): Promise<EvidenceItem[]> {
  const name = `cand-${candidate.id.toLowerCase()}-${jobId.slice(-6)}`;
  const created = await createWorktree(name);
  if (!created.ok) {
    return [
      {
        kind: 'build',
        label: 'isolated verification',
        verdict: 'BLOCKED',
        summary: `worktree unavailable: ${created.detail}`,
      },
    ];
  }
  candidate.worktree = created.path;

  try {
    const root = workspaceRoot();
    const relativeWorktree = toRelative(root, created.path);
    await linkDependencies(root, created.path);
    for (const operation of candidate.operations) {
      const target = resolveInside(created.path, operation.path);
      if (operation.action === 'delete') {
        await fs.rm(target, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, operation.content ?? '', 'utf8');
    }

    const evidence: EvidenceItem[] = [];
    for (const check of checks) {
      evidence.push(await runCheck(check, { cwd: relativeWorktree, taskId: jobId }));
    }
    return evidence;
  } catch (error) {
    return [
      {
        kind: 'build',
        label: 'isolated verification',
        verdict: 'BLOCKED',
        summary: error instanceof Error ? error.message : String(error),
      },
    ];
  } finally {
    const worktrees = await listWorktrees();
    if (worktrees.some((worktree) => worktree.path === created.path)) {
      await removeWorktree(created.path, { confirmed: true }).catch((error: unknown) => {
        logger.warn('tournament', `worktree cleanup failed: ${String(error)}`);
      });
    }
  }
}
