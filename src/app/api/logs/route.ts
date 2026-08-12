import { handleError, ok, searchParams } from '../_lib/http';
import { queryLogs } from '@/core/logging/logger';
import type { LogLevel } from '@/core/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEVELS: LogLevel[] = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEBUG', 'AGENT', 'PROCESS'];

export async function GET(request: Request): Promise<Response> {
  try {
    const params = searchParams(request);
    const levels = (params.get('levels') ?? '')
      .split(',')
      .map((level) => level.trim().toUpperCase())
      .filter((level): level is LogLevel => LEVELS.includes(level as LogLevel));

    return ok({
      logs: queryLogs({
        levels: levels.length > 0 ? levels : undefined,
        taskId: params.get('taskId') ?? undefined,
        search: params.get('search') ?? undefined,
        afterId: params.get('after') ? Number(params.get('after')) : undefined,
        limit: Number(params.get('limit') ?? 200),
      }),
    });
  } catch (error) {
    return handleError('api.logs', error);
  }
}
