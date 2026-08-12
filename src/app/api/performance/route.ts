import { handleError, ok } from '../_lib/http';
import { performanceReport, workspaceSize } from '@/core/tools/performance';
import { routerStats } from '@/core/db/agent-run-repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const [report, size] = await Promise.all([performanceReport(), workspaceSize()]);
    return ok({ ...report, workspace: size, router: routerStats() });
  } catch (error) {
    return handleError('api.performance', error);
  }
}
