import { z } from 'zod';
import { fail, handleError, ok, parseBody } from '../../_lib/http';
import { applyPatch, getPatch, previewPatch } from '@/core/orchestrator/patch-service';
import { runVerificationSuite } from '@/core/tools/verification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const patch = getPatch(id);
    if (!patch) return fail(`Patch not found: ${id}`, 404);
    const preview = await previewPatch(patch.operations);
    return ok({ patch, preview });
  } catch (error) {
    return handleError('api.patches.detail', error);
  }
}

const applySchema = z.object({
  confirmed: z.literal(true),
  verify: z.boolean().optional(),
  checks: z.array(z.enum(['lint', 'typecheck', 'test', 'e2e', 'build'])).optional(),
});

/** Apply a patch to disk (checkpoint first) and optionally verify it. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const patch = getPatch(id);
    if (!patch) return fail(`Patch not found: ${id}`, 404);
    const body = await parseBody(request, applySchema);

    const result = await applyPatch(id);
    const evidence = body.verify
      ? await runVerificationSuite(body.checks ?? ['lint', 'typecheck', 'test', 'build'], {
          taskId: patch.taskId,
        })
      : [];

    return ok({ result, evidence });
  } catch (error) {
    return handleError('api.patches.apply', error);
  }
}
