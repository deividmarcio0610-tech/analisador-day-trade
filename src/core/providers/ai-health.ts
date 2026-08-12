import type { AgentRole, HealthStatus, ModelVerification } from '@/core/types';
import {
  REMOTE_PROVIDER_ID,
  getAgentConfig,
  getProviderConfig,
  providerCredentialsReady,
  remoteConfigured,
  remoteTimeoutMs,
  type ProviderConfig,
} from '@/core/config/config';
import { createProvider } from './registry';
import { probeEndpoint, type ProbeResult } from './endpoint-probe';
import { lastFailure, recordFailure, statusForFailure, type FailureRecord } from './failure';
import { maskEndpoint } from './http';
import { detectStack } from '@/core/tools/stack-detect';
import { logger } from '@/core/logging/logger';

/**
 * REAL health for the AI stack.
 *
 * Two levels, and they are not the same claim:
 *  1. the server answered a model listing  → the host is up;
 *  2. the model answered a real completion → the role can actually work.
 *
 * Only the second one produces ONLINE for a role. An HTTP 200 with an empty
 * body, or an answer from a different model than the one requested, is ERROR.
 */

/** Probe completions are short-lived; a cold GPU still needs room to load. */
const MIN_VERIFY_TIMEOUT_MS = 30_000;
const MAX_VERIFY_TIMEOUT_MS = 180_000;

function verifyTimeoutMs(): number {
  return Math.min(MAX_VERIFY_TIMEOUT_MS, Math.max(MIN_VERIFY_TIMEOUT_MS, remoteTimeoutMs()));
}

const PROBE_TOKEN = 'VISION-OK';

export interface AiProviderView {
  id: string;
  label: string;
  /** Dialect configured; `resolvedKind` is what actually answered. */
  kind: string;
  resolvedKind: string | null;
  maskedEndpoint: string;
  endpointConfigured: boolean;
  apiKeyEnv: string | null;
  apiKeyConfigured: boolean;
  timeoutMs: number;
}

export interface AiStatus {
  configured: boolean;
  provider: AiProviderView;
  server: {
    status: HealthStatus;
    detail: string;
    latencyMs: number | null;
    models: string[];
    probedPath: string | null;
  };
  roles: ModelVerification[];
  judge: { status: 'READY' | 'BLOCKED'; detail: string };
  lastFailure: FailureRecord | null;
  checkedAt: string;
}

function providerView(config: ProviderConfig, probe: ProbeResult | null): AiProviderView {
  return {
    id: config.id,
    label: config.label,
    kind: config.kind,
    resolvedKind: probe?.kind ?? null,
    maskedEndpoint: maskEndpoint(config.baseUrl),
    endpointConfigured: config.baseUrl.length > 0,
    apiKeyEnv: config.apiKeyEnv ?? null,
    apiKeyConfigured: config.apiKeyEnv ? providerCredentialsReady(config) : false,
    timeoutMs: config.timeoutMs ?? remoteTimeoutMs(),
  };
}

/**
 * Ask one role's model for a token and check what came back.
 *
 * Returning 200 is not success: the answer must contain content, and when the
 * server reports which model it used, it must be the one that was requested.
 */
export async function verifyRole(
  role: AgentRole,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ModelVerification> {
  const checkedAt = new Date().toISOString();
  const agent = getAgentConfig(role);
  const base: Omit<ModelVerification, 'status' | 'detail'> = {
    role,
    model: agent.model,
    latencyMs: null,
    reportedModel: null,
    sample: null,
    checkedAt,
  };

  const config = getProviderConfig(agent.providerId);
  if (!config) {
    return { ...base, status: 'NOT_CONFIGURED', detail: `Unknown provider "${agent.providerId}"` };
  }
  if (config.baseUrl.trim().length === 0) {
    return {
      ...base,
      status: 'NOT_CONFIGURED',
      detail:
        config.id === REMOTE_PROVIDER_ID
          ? 'VISION_AI_BASE_URL is not set'
          : `No endpoint configured for provider "${config.id}"`,
    };
  }
  if (!config.enabled) {
    return { ...base, status: 'NOT_CONFIGURED', detail: `Provider "${config.id}" is disabled in settings` };
  }
  if (agent.model.trim().length === 0) {
    const variable = role === 'reviewer' ? 'VISION_DEEPSEEK_MODEL' : 'VISION_QWEN_MODEL';
    return {
      ...base,
      status: 'NOT_CONFIGURED',
      detail: config.id === REMOTE_PROVIDER_ID ? `${variable} is not set` : 'No model selected for this role',
    };
  }

  const provider = createProvider(config);
  const startedAt = Date.now();
  try {
    const result = await provider.chat({
      model: agent.model,
      messages: [
        { role: 'system', content: `Reply with exactly this token and nothing else: ${PROBE_TOKEN}` },
        { role: 'user', content: PROBE_TOKEN },
      ],
      temperature: 0,
      maxTokens: 32,
      timeoutMs: options.timeoutMs ?? verifyTimeoutMs(),
      attempts: 2,
      signal: options.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const content = result.content.trim();
    const sample = content.slice(0, 120);

    if (content.length === 0) {
      return {
        ...base,
        status: 'ERROR',
        latencyMs,
        reportedModel: result.reportedModel,
        detail: 'The server answered but the completion was empty',
      };
    }

    if (result.reportedModel && !modelsMatch(agent.model, result.reportedModel)) {
      return {
        ...base,
        status: 'ERROR',
        latencyMs,
        reportedModel: result.reportedModel,
        sample,
        detail: `Requested "${agent.model}" but the server answered as "${result.reportedModel}"`,
      };
    }

    return {
      ...base,
      status: 'ONLINE',
      latencyMs,
      reportedModel: result.reportedModel,
      sample,
      detail: `Answered ${content.length} character(s) in ${latencyMs} ms`,
    };
  } catch (error) {
    const record = recordFailure(config.id, error);
    logger.warn('ai-health', `${role} verification failed: ${record.message}`, {
      agent: role,
      data: { provider: config.id, kind: record.kind },
    });
    return {
      ...base,
      status: statusForFailure(error),
      latencyMs: Date.now() - startedAt,
      detail: record.message,
    };
  }
}

/**
 * Model ids are compared loosely: servers commonly return a fully qualified name
 * (`/models/qwen2.5-coder-14b`) for a short alias, or drop the `:latest` tag.
 */
export function modelsMatch(requested: string, reported: string): boolean {
  const normalize = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/:latest$/, '')
      .replace(/^.*[/\\]/, '');
  const a = normalize(requested);
  const b = normalize(reported);
  if (a === b) return true;
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

/** Full AI status: endpoint probe, per-role verification and judge readiness. */
export async function aiStatus(
  options: { verifyModels?: boolean; signal?: AbortSignal } = {},
): Promise<AiStatus> {
  const checkedAt = new Date().toISOString();
  const config = getProviderConfig(REMOTE_PROVIDER_ID) ?? {
    id: REMOTE_PROVIDER_ID,
    label: 'Remote GPU endpoint',
    kind: 'ollama' as const,
    baseUrl: '',
    enabled: false,
  };

  const configured = remoteConfigured();
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;

  const probe = configured
    ? await probeEndpoint(config.baseUrl, { apiKey, signal: options.signal })
    : null;

  // Record the original error so the diagnostics keep its classification
  // (unreachable / auth / not-found) instead of degrading it to "unknown".
  if (probe && probe.status !== 'ONLINE' && probe.status !== 'NOT_CONFIGURED') {
    recordFailure(config.id, probe.error ?? new Error(probe.detail));
  }

  const roles: AgentRole[] = ['builder', 'reviewer'];
  const verifications: ModelVerification[] = [];

  for (const role of roles) {
    if (options.verifyModels === false || !configured || probe?.status !== 'ONLINE') {
      const agent = getAgentConfig(role);
      verifications.push({
        role,
        model: agent.model,
        status: configured ? (probe?.status ?? 'UNKNOWN') : 'NOT_CONFIGURED',
        latencyMs: null,
        reportedModel: null,
        sample: null,
        detail: configured
          ? `Not verified: the endpoint is ${probe?.status ?? 'UNKNOWN'}`
          : 'VISION_AI_BASE_URL is not set',
        checkedAt,
      });
      continue;
    }
    verifications.push(await verifyRole(role, { signal: options.signal }));
  }

  const judge = await judgeReadiness();

  return {
    configured,
    provider: providerView(config, probe),
    server: {
      status: probe?.status ?? 'NOT_CONFIGURED',
      detail: probe?.detail ?? 'VISION_AI_BASE_URL is not set',
      latencyMs: probe?.latencyMs ?? null,
      models: probe?.models ?? [],
      probedPath: probe?.probedPath ?? null,
    },
    roles: verifications,
    judge,
    lastFailure: lastFailure(config.id),
    checkedAt,
  };
}

/**
 * The judge is deterministic code, so it does not depend on a model: it is READY
 * when the project exposes at least one command able to produce evidence.
 */
export async function judgeReadiness(): Promise<{ status: 'READY' | 'BLOCKED'; detail: string }> {
  try {
    const stack = await detectStack();
    const available = Object.entries(stack.commands)
      .filter(([key, value]) => value !== null && key !== 'install')
      .map(([key]) => key);
    if (available.length === 0) {
      return {
        status: 'BLOCKED',
        detail: 'No lint, typecheck, test or build command detected — there is nothing to verify with',
      };
    }
    return { status: 'READY', detail: `evidence commands available: ${available.join(', ')}` };
  } catch (error) {
    return { status: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Guard used before a council run. Returns null when the role can work, or a
 * human-readable reason when it cannot — the caller turns that into a BLOCKED
 * job instead of letting the run fail deep inside an agent turn.
 */
export function roleUnavailableReason(role: AgentRole): string | null {
  const agent = getAgentConfig(role);
  const config = getProviderConfig(agent.providerId);
  if (!config) return `Unknown provider "${agent.providerId}" for the ${role}`;
  if (config.baseUrl.trim().length === 0) {
    return config.id === REMOTE_PROVIDER_ID
      ? 'GPU/MODEL UNAVAILABLE — VISION_AI_BASE_URL is not set'
      : `GPU/MODEL UNAVAILABLE — no endpoint configured for "${config.id}"`;
  }
  if (!config.enabled) return `GPU/MODEL UNAVAILABLE — provider "${config.id}" is disabled`;
  if (agent.model.trim().length === 0) {
    const variable = role === 'reviewer' ? 'VISION_DEEPSEEK_MODEL' : 'VISION_QWEN_MODEL';
    return `GPU/MODEL UNAVAILABLE — no model configured for the ${role} (${variable})`;
  }
  return null;
}
