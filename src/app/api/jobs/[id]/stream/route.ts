import { sseResponse, searchParams } from '../../../_lib/http';
import { eventsSince, subscribe, getJob, isTerminal } from '@/core/orchestrator/job-store';
import type { JobEvent } from '@/core/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Replays persisted events from `?after=<id>` and then streams live ones, so a
 * page reload resumes exactly where it left off.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const after = Number(searchParams(request).get('after') ?? 0);

  return sseResponse((send, close) => {
    const job = getJob(id);
    if (!job) {
      send('error', { message: `Job not found: ${id}` });
      close();
      return;
    }

    let lastId = Number.isFinite(after) ? after : 0;
    for (const event of eventsSince(id, lastId)) {
      send(event.type, event);
      lastId = event.id;
    }

    send('replay.done', { lastId, state: job.state });

    if (isTerminal(job.state)) {
      close();
      return;
    }

    const unsubscribe = subscribe(id, (event: JobEvent) => {
      if (event.id <= lastId) return;
      lastId = event.id;
      send(event.type, event);
      if (event.type === 'job.done' || event.type === 'job.error') {
        setTimeout(close, 250);
      }
    });

    return unsubscribe;
  });
}
