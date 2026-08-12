import { handleError, ok, searchParams } from '../_lib/http';
import { buildCodeGraph, findCycles } from '@/core/context/code-graph';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const force = searchParams(request).get('force') === 'true';
    const graph = await buildCodeGraph({ force });
    return ok({ ...graph, cycles: findCycles(graph, 20) });
  } catch (error) {
    return handleError('api.graph', error);
  }
}
