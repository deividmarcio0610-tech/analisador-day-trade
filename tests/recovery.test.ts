import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Crash recovery and the watchdog: a job that dies mid-run keeps its work, and a
 * job that stops progressing is stopped rather than left spinning.
 */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-recovery-'));

beforeAll(() => {
  process.env.VISION_WORKSPACE_ROOT = workspace;
  process.env.VISION_DATA_DIR = path.join(workspace, '.vision');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'recovery-fixture', scripts: { test: 'echo ok' } }),
  );
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('crash recovery', () => {
  it('marks an in-flight job INTERRUPTED, not FAILED, after a restart', async () => {
    const { createJob, setJobState, reconcileOrphanJobs, getJob } = await import(
      '@/core/orchestrator/job-store'
    );
    const job = createJob({ projectId: 'p', mode: 'ENGINEER', command: 'solve', prompt: 'work' });
    setJobState(job.id, 'RUNNING');

    reconcileOrphanJobs();

    const recovered = getJob(job.id);
    expect(recovered?.state).toBe('INTERRUPTED');
    expect(recovered?.error).toContain('resumable');
  });

  it('rebuilds the plan, the patch and the review feedback from what was persisted', async () => {
    const { createJob, emit } = await import('@/core/orchestrator/job-store');
    const { storePatch } = await import('@/core/orchestrator/patch-service');
    const { recoverState } = await import('@/core/orchestrator/runner');

    const job = createJob({ projectId: 'p', mode: 'ENGINEER', command: 'solve', prompt: 'work' });
    emit(job.id, 'plan', {
      summary: 'add the helper',
      requirements: [{ id: 'H-001', statement: 'returns the sum', verification: 'unit test' }],
      steps: [{ id: 'S1', title: 'create file', detail: 'src/sum.ts', files: ['src/sum.ts'] }],
    });
    storePatch({
      taskId: job.id,
      round: 1,
      author: 'builder',
      operations: [{ path: 'src/sum.ts', action: 'create', content: 'export const sum = 1;\n' }],
    });
    emit(job.id, 'patch', { patchId: 'x', round: 1 });
    emit(job.id, 'review', {
      round: 1,
      decision: 'REJECTED',
      findings: [
        { severity: 'blocker', category: 'bug', file: 'src/sum.ts', summary: 'wrong', detail: 'returns a constant' },
      ],
    });

    const state = recoverState(job.id);
    expect(state?.planText).toContain('H-001');
    expect(state?.operations[0]?.path).toBe('src/sum.ts');
    expect(state?.patchId).not.toBeNull();
    expect(state?.reviewFeedback).toContain('returns a constant');
    // A review for round 1 means the next attempt is round 2.
    expect(state?.round).toBe(2);
  });

  it('returns nothing to recover for a job that never produced events', async () => {
    const { recoverState } = await import('@/core/orchestrator/runner');
    expect(recoverState('job_does_not_exist')).toBeNull();
  });

  it('refuses to resume a job that is not interrupted', async () => {
    const { createJob, setJobState } = await import('@/core/orchestrator/job-store');
    const { resumeJob } = await import('@/core/orchestrator/runner');
    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'x' });
    setJobState(job.id, 'PASSED');

    const result = resumeJob(job.id);
    expect(result.resumed).toBe(false);
    expect(result.reason).toContain('PASSED');
  });

  it('blocks a resume when the models are unavailable instead of losing the work', async () => {
    delete process.env.VISION_AI_BASE_URL;
    const { createJob, setJobState, getJob } = await import('@/core/orchestrator/job-store');
    const { setRemoteOverride, setAgents } = await import('@/core/config/config');
    const { resumeJob } = await import('@/core/orchestrator/runner');

    setRemoteOverride({ baseUrl: '' });
    // Point the roles at the remote provider with no endpoint configured.
    setAgents([
      { role: 'planner', label: 'Planner', providerId: 'vision-gpu', model: '', temperature: 0, maxTokens: 1024 },
      { role: 'builder', label: 'Builder', providerId: 'vision-gpu', model: '', temperature: 0, maxTokens: 1024 },
      { role: 'reviewer', label: 'Reviewer', providerId: 'vision-gpu', model: '', temperature: 0, maxTokens: 1024 },
    ]);

    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'x' });
    setJobState(job.id, 'INTERRUPTED');

    const result = resumeJob(job.id);
    expect(result.resumed).toBe(false);
    expect(result.reason).toContain('GPU/MODEL UNAVAILABLE');
    expect(getJob(job.id)?.state).toBe('BLOCKED');
  });
});

describe('watchdog', () => {
  it('ignores a job that is still producing events', async () => {
    const { createJob, setJobState, emit } = await import('@/core/orchestrator/job-store');
    const { findStalledJobs } = await import('@/core/orchestrator/watchdog');

    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'busy' });
    setJobState(job.id, 'RUNNING');
    emit(job.id, 'log', { level: 'INFO', message: 'still working' });

    const stalled = findStalledJobs(60_000).map((entry) => entry.jobId);
    expect(stalled).not.toContain(job.id);
  });

  it('detects and blocks a job that stopped progressing', async () => {
    const { createJob, setJobState, emit, getJob } = await import('@/core/orchestrator/job-store');
    const { sweepStalledJobs } = await import('@/core/orchestrator/watchdog');

    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'stuck' });
    setJobState(job.id, 'RUNNING');
    emit(job.id, 'log', { level: 'INFO', message: 'last sign of life' });

    // Zero idle tolerance: everything active counts as stalled right now.
    const swept = sweepStalledJobs(0).map((entry) => entry.jobId);
    expect(swept).toContain(job.id);

    const after = getJob(job.id);
    expect(after?.state).toBe('BLOCKED');
    expect(after?.error).toContain('no progress');
  });

  it('leaves finished jobs alone', async () => {
    const { createJob, setJobState, getJob } = await import('@/core/orchestrator/job-store');
    const { sweepStalledJobs } = await import('@/core/orchestrator/watchdog');

    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'done' });
    setJobState(job.id, 'PASSED');

    sweepStalledJobs(0);
    expect(getJob(job.id)?.state).toBe('PASSED');
  });
});
