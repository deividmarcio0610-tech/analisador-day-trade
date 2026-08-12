import type { HealthStatus, ProviderKind } from '@/core/types';
import { ProviderHttpError, joinUrl, requestJson } from './http';
import { statusForFailure } from './failure';

/**
 * Endpoint probe.
 *
 * A remote GPU box may expose a native Ollama daemon or an OpenAI-compatible
 * server, and the URL alone does not always say which. The probe asks the server
 * and reports what actually answered, so the platform never guesses a dialect.
 */

export interface ProbeResult {
  /** Dialect that answered, or null when nothing did. */
  kind: ProviderKind | null;
  /** Base URL to talk to, which may differ from the one supplied (…/v1). */
  effectiveBaseUrl: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
  models: string[];
  probedPath: string | null;
  /** The underlying failure, kept so diagnostics can classify it correctly. */
  error: ProviderHttpError | null;
}

interface Candidate {
  path: string;
  kind: ProviderKind;
  /** Base URL implied by this candidate answering. */
  base: (baseUrl: string) => string;
  extract: (payload: unknown) => string[];
}

const CANDIDATES: Candidate[] = [
  {
    path: 'api/tags',
    kind: 'ollama',
    base: (baseUrl) => baseUrl,
    extract: (payload) => {
      const data = payload as { models?: Array<{ name?: unknown }> };
      return (data.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => typeof name === 'string');
    },
  },
  {
    path: 'models',
    kind: 'openai-compatible',
    base: (baseUrl) => baseUrl,
    extract: (payload) => {
      const data = payload as { data?: Array<{ id?: unknown }> };
      return (data.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => typeof id === 'string');
    },
  },
  {
    path: 'v1/models',
    kind: 'openai-compatible',
    base: (baseUrl) => joinUrl(baseUrl, 'v1'),
    extract: (payload) => {
      const data = payload as { data?: Array<{ id?: unknown }> };
      return (data.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => typeof id === 'string');
    },
  },
];

const PROBE_TIMEOUT_MS = 8_000;

export async function probeEndpoint(
  baseUrl: string,
  options: { apiKey?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return {
      kind: null,
      effectiveBaseUrl: '',
      status: 'NOT_CONFIGURED',
      detail: 'No endpoint configured (VISION_AI_BASE_URL is empty)',
      latencyMs: null,
      models: [],
      probedPath: null,
      error: null,
    };
  }

  const headers = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined;
  const startedAt = Date.now();
  const errors: ProviderHttpError[] = [];
  const perCandidateTimeout = options.timeoutMs ?? PROBE_TIMEOUT_MS;

  for (const candidate of CANDIDATES) {
    try {
      const payload = await requestJson<unknown>(joinUrl(trimmed, candidate.path), {
        // Discovery is a single attempt per path: the status poll must stay fast
        // even when the host is down. Retries belong to the real calls.
        timeoutMs: perCandidateTimeout,
        headers,
        attempts: 1,
        signal: options.signal,
      });
      const models = candidate.extract(payload);
      return {
        kind: candidate.kind,
        effectiveBaseUrl: candidate.base(trimmed),
        status: 'ONLINE',
        detail: `${candidate.kind} endpoint answered on /${candidate.path} with ${models.length} model(s)`,
        latencyMs: Date.now() - startedAt,
        models,
        probedPath: `/${candidate.path}`,
        error: null,
      };
    } catch (error) {
      if (!(error instanceof ProviderHttpError)) throw error;
      errors.push(error);
      // Only a per-path failure is worth trying the next path for. If the host
      // itself is unreachable, or it answered and rejected us, the answer is
      // already known — probing further paths would just add dead time.
      if (error.kind === 'unreachable' || error.kind === 'timeout' || error.kind === 'auth') break;
    }
  }

  const decisive = errors.find((error) => error.kind === 'auth') ?? errors[0];
  return {
    kind: null,
    effectiveBaseUrl: trimmed,
    status: decisive ? statusForFailure(decisive) : 'OFFLINE',
    detail: decisive
      ? decisive.message
      : `No known model API answered at ${trimmed} (tried /api/tags, /models, /v1/models)`,
    latencyMs: Date.now() - startedAt,
    models: [],
    probedPath: null,
    error: decisive ?? null,
  };
}
