import { fail, handleError, ok } from '../../_lib/http';
import { getJob, eventsSince, cancelJob, isJobActive, setJobState } from '@/core/orchestrator/job-store';
import { listPatches } from '@/core/orchestrator/patch-service';
import { listMessages } from '@/core/agents/agent-runtime';
import { listAgentRuns } from '@/core/db/agent-run-repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return fail(`Job not found: ${id}`, 404);
    return ok({
      job,
      active: isJobActive(id),
      events: eventsSince(id, 0),
      patches: listPatches(id),
      runs: listAgentRuns(id),
      messages: listMessages(id).map((message) => ({
        ...message,
        content: message.content.slice(0, 20_000),
      })),
    });
  } catch (error) {
    return handleError('api.jobs.detail', error);
  }
}

/** Cancel a running job: aborts the model call and any process it started. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return fail(`Job not found: ${id}`, 404);
    const cancelled = cancelJob(id);
    if (cancelled) setJobState(id, 'CANCELLED', 'Cancelled by user');
    return ok({ cancelled, jobId: id });
  } catch (error) {
    return handleError('api.jobs.cancel', error);
  }
}
