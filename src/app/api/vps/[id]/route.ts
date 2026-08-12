import { fail, handleError, ok } from '../../_lib/http';
import { checkConnection, getConnection } from '@/core/tools/vps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Reachability probe for one stored connection. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!getConnection(id)) return fail(`Connection not found: ${id}`, 404);
    return ok(await checkConnection(id));
  } catch (error) {
    return handleError('api.vps.check', error);
  }
}
