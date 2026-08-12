import { handleError, ok, searchParams } from '../../_lib/http';
import { aiStatus } from '@/core/providers/ai-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * AI diagnostics.
 *
 * Reports provider, masked endpoint, models, latency, health and the last
 * failure. It never returns the API key, and never reports a key value — only
 * whether the environment variable is present.
 *
 * `?verify=false` skips the model completions and only probes the endpoint,
 * which is what the polled status widgets use.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const verify = searchParams(request).get('verify') !== 'false';
    return ok(await aiStatus({ verifyModels: verify }));
  } catch (error) {
    return handleError('api.ai.diagnostics', error);
  }
}
