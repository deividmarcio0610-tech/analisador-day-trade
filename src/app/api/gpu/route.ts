import { handleError, ok } from '../_lib/http';
import { gpuStatus } from '@/core/tools/gpu';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return ok(await gpuStatus());
  } catch (error) {
    return handleError('api.gpu', error);
  }
}
