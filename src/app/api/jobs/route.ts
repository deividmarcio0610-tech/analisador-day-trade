import { z } from 'zod';
import { handleError, ok, parseBody, searchParams } from '../_lib/http';
import { listJobs } from '@/core/orchestrator/job-store';
import { startJob } from '@/core/orchestrator/runner';
import { RUN_MODES } from '@/core/orchestrator/modes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const limit = Number(searchParams(request).get('limit') ?? 30);
    return ok({ jobs: listJobs(Math.min(Math.max(limit, 1), 200)) });
  } catch (error) {
    return handleError('api.jobs', error);
  }
}

const schema = z.object({
  prompt: z.string().min(1),
  command: z.string().default('ask'),
  mode: z.enum(RUN_MODES as [string, ...string[]]).optional(),
  focusFiles: z.array(z.string()).optional(),
  applyAndVerify: z.boolean().optional(),
  checks: z.array(z.enum(['lint', 'typecheck', 'test', 'e2e', 'build'])).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, schema);
    const job = startJob({
      prompt: body.prompt,
      command: body.command,
      mode: body.mode as (typeof RUN_MODES)[number] | undefined,
      focusFiles: body.focusFiles,
      applyAndVerify: body.applyAndVerify,
      checks: body.checks,
    });
    return ok({ job }, { status: 202 });
  } catch (error) {
    return handleError('api.jobs', error);
  }
}
