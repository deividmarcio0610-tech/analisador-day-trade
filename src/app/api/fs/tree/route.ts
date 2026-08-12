import { handleError, ok, searchParams } from '../../_lib/http';
import { listDirectory } from '@/core/tools/filesystem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const target = searchParams(request).get('path') ?? '.';
    return ok({ path: target, entries: await listDirectory(target) });
  } catch (error) {
    return handleError('api.fs.tree', error);
  }
}
