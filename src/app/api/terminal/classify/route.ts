import { z } from 'zod';
import { handleError, ok, parseBody } from '../../_lib/http';
import { classifyCommand, requiresConfirmation } from '@/core/safety/command-safety';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ commandLine: z.string().min(1) });

/** Pre-flight classification so the UI can warn before anything runs. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, schema);
    const verdict = classifyCommand(body.commandLine);
    return ok({ ...verdict, requiresConfirmation: requiresConfirmation(verdict.risk) });
  } catch (error) {
    return handleError('api.terminal.classify', error);
  }
}
