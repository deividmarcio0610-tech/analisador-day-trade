import { z } from 'zod';
import { handleError, ok, parseBody } from '../_lib/http';
import { runCheck, listTestRuns } from '@/core/tools/verification';
import { detectStack } from '@/core/tools/stack-detect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const stack = await detectStack();
    return ok({ commands: stack.commands, runners: stack.testRunners, history: listTestRuns(30) });
  } catch (error) {
    return handleError('api.checks', error);
  }
}

const schema = z.object({
  kind: z.enum(['lint', 'typecheck', 'test', 'e2e', 'build']),
  cwd: z.string().optional(),
  taskId: z.string().optional(),
});

/** Run one project check and return its evidence. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, schema);
    const evidence = await runCheck(body.kind, { cwd: body.cwd, taskId: body.taskId });
    return ok(evidence);
  } catch (error) {
    return handleError('api.checks', error);
  }
}
