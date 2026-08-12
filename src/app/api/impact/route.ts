import { z } from 'zod';
import { handleError, ok, parseBody } from '../_lib/http';
import { analyzeImpact } from '@/core/context/impact';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  files: z.array(z.string().min(1)).min(1),
  depth: z.number().int().min(1).max(6).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, schema);
    return ok(await analyzeImpact(body.files, { depth: body.depth }));
  } catch (error) {
    return handleError('api.impact', error);
  }
}
