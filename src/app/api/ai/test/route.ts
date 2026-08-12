import { handleError, ok } from '../../_lib/http';
import { runPipelineCheck } from '@/core/providers/pipeline-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Test Connection.
 *
 * Runs the real council round trip — builder produces a patch, reviewer reviews
 * that patch — and reports each stage. A stage is only ONLINE when its content
 * was usable, so this cannot pass on an empty or wrong-model answer.
 */
export async function POST(): Promise<Response> {
  try {
    const result = await runPipelineCheck();
    return ok(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    return handleError('api.ai.test', error);
  }
}
