import { z } from 'zod';
import { fail, handleError, ok, parseBody } from '../_lib/http';
import { COMMANDS, parseCommand } from '@/core/commands/registry';
import { buildFinalizeReport, buildProveReport } from '@/core/commands/reports';
import { startJob } from '@/core/orchestrator/runner';
import { runCheck } from '@/core/tools/verification';
import { projectHealth } from '@/core/quality/project-health';
import { analyzeTechnicalDebt } from '@/core/quality/tech-debt';
import { runSecurityReview } from '@/core/quality/security-review';
import { analyzeApiContract } from '@/core/quality/api-contract';
import { fullDatabaseReport } from '@/core/tools/database-doctor';
import { performanceReport } from '@/core/tools/performance';
import { gpuStatus } from '@/core/tools/gpu';
import { listConnections } from '@/core/tools/vps';
import { listRunningProcesses } from '@/core/tools/process-runner';
import { listJobs } from '@/core/orchestrator/job-store';
import {
  gitBranches,
  gitDiff,
  gitLog,
  gitStashList,
  gitStatus,
  listCheckpoints,
  listWorktrees,
} from '@/core/tools/git';
import { gitDiffFocusFiles } from './focus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return ok({ commands: COMMANDS });
}

const schema = z.object({
  input: z.string().min(1),
  mode: z
    .enum(['FAST', 'ENGINEER', 'DEEP_ANALYSIS', 'ARCHITECT', 'DEBUG', 'TEAM', 'EXTREME'])
    .optional(),
  focusFiles: z.array(z.string()).optional(),
  applyAndVerify: z.boolean().optional(),
});

/**
 * Single entry point for the prompt bar. Orchestrated commands return a job to
 * follow on the event stream; tool commands return their data directly.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, schema);
    const parsed = parseCommand(body.input);
    if (parsed.error) return fail(parsed.error, 400, { usage: parsed.command?.usage });

    // Free-form prompt: run the default (or requested) mode.
    if (!parsed.command) {
      const job = startJob({
        prompt: parsed.rest,
        command: 'ask',
        mode: body.mode,
        focusFiles: body.focusFiles,
        applyAndVerify: body.applyAndVerify,
      });
      return ok({ kind: 'job', job }, { status: 202 });
    }

    if (parsed.command.kind === 'orchestrated') {
      const focusFiles =
        parsed.command.name === 'review' && (!body.focusFiles || body.focusFiles.length === 0)
          ? await gitDiffFocusFiles()
          : body.focusFiles;

      const prompt =
        parsed.rest.length > 0
          ? parsed.rest
          : 'Review the current uncommitted changes in this workspace and report real problems.';

      const job = startJob({
        prompt,
        command: parsed.command.name,
        mode: body.mode ?? parsed.command.mode,
        focusFiles,
        applyAndVerify: body.applyAndVerify ?? parsed.command.verify,
      });
      return ok({ kind: 'job', job }, { status: 202 });
    }

    const data = await runToolCommand(parsed.command.name, parsed.rest);
    return ok({ kind: 'result', command: parsed.command.name, data });
  } catch (error) {
    return handleError('api.command', error);
  }
}

async function runToolCommand(name: string, argument: string): Promise<unknown> {
  switch (name) {
    case 'test':
      return runCheck('test');
    case 'build':
      return runCheck('build');
    case 'health':
      return projectHealth();
    case 'status':
      return {
        jobs: listJobs(20),
        processes: listRunningProcesses(),
        git: await gitStatus(),
      };
    case 'git':
      return {
        status: await gitStatus(),
        diff: await gitDiff({}),
        commits: await gitLog(20),
        branches: await gitBranches(),
        stashes: await gitStashList(),
        checkpoints: await listCheckpoints(),
        worktrees: await listWorktrees(),
      };
    case 'database':
      return fullDatabaseReport();
    case 'performance':
      return performanceReport();
    case 'gpu':
      return gpuStatus();
    case 'vps':
      return { connections: listConnections() };
    case 'audit':
      return {
        debt: await analyzeTechnicalDebt(),
        security: await runSecurityReview(),
        contract: await analyzeApiContract(),
      };
    case 'finalize':
      return buildFinalizeReport();
    case 'prove': {
      const report = buildProveReport(argument.trim() || undefined);
      if (!report) throw new Error('No job to prove yet — run a task first.');
      return report;
    }
    default:
      throw new Error(`Command "${name}" has no server implementation`);
  }
}
