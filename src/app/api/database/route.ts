import { handleError, ok } from '../_lib/http';
import { fullDatabaseReport } from '@/core/tools/database-doctor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return ok(await fullDatabaseReport());
  } catch (error) {
    return handleError('api.database', error);
  }
}
