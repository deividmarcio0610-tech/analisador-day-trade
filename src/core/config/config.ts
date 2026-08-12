import { getSetting, setSetting } from '@/core/db/settings-repo';
import type { AgentRole, ProviderKind, RunMode } from '@/core/types';

/**
 * Runtime configuration.
 *
 * The remote GPU endpoint is configured entirely through environment variables
 * so no credential ever reaches the database or the browser. Everything else is
 * editable from Settings and persisted in SQLite; stored values override the
 * environment-derived defaults field by field, and a provider that exists in the
 * defaults is never dropped by an older stored payload.
 */

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Name of the env var holding the API key (server side only). */
  apiKeyEnv?: string;
  enabled: boolean;
  /** Per-request timeout for completions. Health probes use a shorter one. */
  timeoutMs?: number;
}

export interface AgentConfig {
  role: AgentRole;
  label: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface OrchestratorConfig {
  maxRounds: number;
  defaultMode: RunMode;
  autoApplyPatches: boolean;
  runTestsAutomatically: boolean;
}

export interface VisionConfig {
  providers: ProviderConfig[];
  agents: AgentConfig[];
  orchestrator: OrchestratorConfig;
}

/** Provider id of the remote GPU endpoint (Vast.ai or any other host). */
export const REMOTE_PROVIDER_ID = 'vision-gpu';

export const DEFAULT_TIMEOUT_MS = 600_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 3_600_000;

function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function clampTimeout(value: number): number {
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

/**
 * Completion timeout in milliseconds: Settings first, then `VISION_AI_TIMEOUT`,
 * clamped to a sane range so a typo cannot hang a run for a day.
 */
export function remoteTimeoutMs(): number {
  const override = getSetting<{ timeoutMs?: number }>('remote-ai', {}).timeoutMs;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return clampTimeout(override);
  }
  const raw = envValue('VISION_AI_TIMEOUT');
  if (raw.length === 0) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return clampTimeout(parsed);
}

/**
 * Kind implied by the endpoint shape. A URL ending in `/v1` is the
 * OpenAI-compatible dialect (vLLM, llama.cpp, TGI, gateways); anything else is
 * assumed to be a native Ollama daemon. The probe in `endpoint-probe.ts`
 * confirms this against the live server and reports what actually answered.
 */
export function inferProviderKind(baseUrl: string): ProviderKind {
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  if (normalized.endsWith('/v1') || normalized.includes('/v1/')) return 'openai-compatible';
  return 'ollama';
}

/**
 * Editable half of the remote configuration.
 *
 * A Vast.ai instance gets a new host and port every time it is restarted, so the
 * endpoint has to be changeable without restarting the platform. These fields
 * default to the environment and can be overridden from Settings; the API key is
 * deliberately absent — it is read from the environment, server side, only.
 */
export interface RemoteOverride {
  baseUrl?: string;
  builderModel?: string;
  reviewerModel?: string;
  timeoutMs?: number;
}

const KEY_REMOTE = 'remote-ai';

export function getRemoteOverride(): RemoteOverride {
  return getSetting<RemoteOverride>(KEY_REMOTE, {});
}

export function setRemoteOverride(override: RemoteOverride): void {
  const current = getRemoteOverride();
  const merged: RemoteOverride = { ...current, ...override };
  // An empty string clears the override and falls back to the environment.
  for (const key of ['baseUrl', 'builderModel', 'reviewerModel'] as const) {
    if (merged[key] !== undefined && merged[key]?.trim() === '') delete merged[key];
  }
  if (merged.timeoutMs !== undefined && (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0)) {
    delete merged.timeoutMs;
  }
  setSetting(KEY_REMOTE, merged);
}

/** Where an effective value came from, so the UI can say so instead of implying. */
export type ValueSource = 'settings' | 'env' | 'unset';

export function remoteBaseUrl(): string {
  return (getRemoteOverride().baseUrl ?? '').trim() || envValue('VISION_AI_BASE_URL');
}

export function remoteBaseUrlSource(): ValueSource {
  if ((getRemoteOverride().baseUrl ?? '').trim().length > 0) return 'settings';
  return envValue('VISION_AI_BASE_URL').length > 0 ? 'env' : 'unset';
}

export function remoteBuilderModel(): string {
  return (getRemoteOverride().builderModel ?? '').trim() || envValue('VISION_QWEN_MODEL');
}

export function remoteBuilderModelSource(): ValueSource {
  if ((getRemoteOverride().builderModel ?? '').trim().length > 0) return 'settings';
  return envValue('VISION_QWEN_MODEL').length > 0 ? 'env' : 'unset';
}

export function remoteReviewerModel(): string {
  return (getRemoteOverride().reviewerModel ?? '').trim() || envValue('VISION_DEEPSEEK_MODEL');
}

export function remoteReviewerModelSource(): ValueSource {
  if ((getRemoteOverride().reviewerModel ?? '').trim().length > 0) return 'settings';
  return envValue('VISION_DEEPSEEK_MODEL').length > 0 ? 'env' : 'unset';
}

export function remoteConfigured(): boolean {
  return remoteBaseUrl().length > 0;
}

function remoteProvider(): ProviderConfig {
  const baseUrl = remoteBaseUrl();
  return {
    id: REMOTE_PROVIDER_ID,
    label: 'Remote GPU endpoint',
    kind: inferProviderKind(baseUrl),
    baseUrl,
    apiKeyEnv: 'VISION_AI_API_KEY',
    // Nothing to reach until an endpoint is provided: the UI shows NOT CONFIGURED.
    enabled: baseUrl.length > 0,
    timeoutMs: remoteTimeoutMs(),
  };
}

export function defaultProviders(): ProviderConfig[] {
  return [
    remoteProvider(),
    {
      id: 'ollama-local',
      label: 'Ollama (local)',
      kind: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      enabled: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    {
      id: 'vllm-local',
      label: 'vLLM (local)',
      kind: 'vllm',
      baseUrl: process.env.VLLM_BASE_URL ?? 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'VLLM_API_KEY',
      enabled: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    {
      id: 'openai-compatible',
      label: 'OpenAI-compatible endpoint',
      kind: 'openai-compatible',
      baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://127.0.0.1:8080/v1',
      apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
      enabled: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  ];
}

/**
 * Role defaults.
 *
 * Qwen builds, DeepSeek reviews. Model names come from the environment and are
 * left empty when unset — an empty model is reported as NOT_CONFIGURED rather
 * than filled in with a guess. The judge is deterministic code and has no model.
 */
export function defaultAgents(): AgentConfig[] {
  const remote = remoteConfigured();
  const providerId = remote ? REMOTE_PROVIDER_ID : 'ollama-local';
  const builderModel = remote ? remoteBuilderModel() : 'qwen2.5-coder:14b';
  const reviewerModel = remote ? remoteReviewerModel() : 'deepseek-r1:14b';

  return [
    {
      role: 'planner',
      label: 'Planner',
      providerId,
      model: builderModel,
      temperature: 0.2,
      maxTokens: 4096,
    },
    {
      role: 'builder',
      label: 'Builder',
      providerId,
      model: builderModel,
      temperature: 0.1,
      maxTokens: 8192,
    },
    {
      role: 'reviewer',
      label: 'Reviewer',
      providerId,
      model: reviewerModel,
      temperature: 0.2,
      maxTokens: 8192,
    },
  ];
}

export const DEFAULT_ORCHESTRATOR: OrchestratorConfig = {
  maxRounds: 3,
  defaultMode: 'ENGINEER',
  autoApplyPatches: false,
  runTestsAutomatically: true,
};

const KEY_PROVIDERS = 'providers';
const KEY_AGENTS = 'agents';
const KEY_ORCHESTRATOR = 'orchestrator';

/**
 * Merge stored settings over the environment-derived defaults.
 *
 * The remote provider's endpoint and credentials always come from the
 * environment: a stored payload can enable or rename it, but it cannot point the
 * platform somewhere else or carry a key.
 */
export function getProviders(): ProviderConfig[] {
  const defaults = defaultProviders();
  const stored = getSetting<ProviderConfig[] | null>(KEY_PROVIDERS, null);
  if (!stored || stored.length === 0) return defaults;

  const merged = defaults.map((fallback) => {
    const override = stored.find((provider) => provider.id === fallback.id);
    if (!override) return fallback;
    if (fallback.id === REMOTE_PROVIDER_ID) {
      return {
        ...fallback,
        label: override.label || fallback.label,
        enabled: fallback.baseUrl.length > 0 && override.enabled !== false,
      };
    }
    return { ...fallback, ...override, id: fallback.id };
  });

  const custom = stored.filter(
    (provider) => !defaults.some((fallback) => fallback.id === provider.id),
  );
  return [...merged, ...custom];
}

export function setProviders(providers: ProviderConfig[]): void {
  setSetting(KEY_PROVIDERS, providers);
}

export function getAgents(): AgentConfig[] {
  const defaults = defaultAgents();
  const stored = getSetting<AgentConfig[] | null>(KEY_AGENTS, null);
  if (!stored || stored.length === 0) return defaults;
  // Merge so a newly introduced role is never missing.
  return defaults.map((fallback) => {
    const override = stored.find((agent) => agent.role === fallback.role);
    return override ? { ...fallback, ...override } : fallback;
  });
}

export function setAgents(agents: AgentConfig[]): void {
  setSetting(KEY_AGENTS, agents);
}

export function getAgentConfig(role: AgentRole): AgentConfig {
  const found = getAgents().find((agent) => agent.role === role);
  if (found) return found;
  const fallback = defaultAgents().find((agent) => agent.role === role);
  if (!fallback) throw new Error(`No configuration for agent role "${role}"`);
  return fallback;
}

export function getProviderConfig(id: string): ProviderConfig | null {
  return getProviders().find((provider) => provider.id === id) ?? null;
}

export function getOrchestratorConfig(): OrchestratorConfig {
  return {
    ...DEFAULT_ORCHESTRATOR,
    ...getSetting<Partial<OrchestratorConfig>>(KEY_ORCHESTRATOR, {}),
  };
}

export function setOrchestratorConfig(config: Partial<OrchestratorConfig>): void {
  setSetting(KEY_ORCHESTRATOR, { ...getOrchestratorConfig(), ...config });
}

export function getConfig(): VisionConfig {
  return {
    providers: getProviders(),
    agents: getAgents(),
    orchestrator: getOrchestratorConfig(),
  };
}

/** True when the provider has an API key requirement that the environment satisfies. */
export function providerCredentialsReady(provider: ProviderConfig): boolean {
  if (!provider.apiKeyEnv) return true;
  const value = process.env[provider.apiKeyEnv];
  return typeof value === 'string' && value.length > 0;
}

/**
 * The remote endpoint may be open (a private Vast instance without a gateway
 * key), so a missing key is not a failure by itself — it is only reported.
 */
export function providerRequiresKey(provider: ProviderConfig): boolean {
  return provider.id !== REMOTE_PROVIDER_ID && Boolean(provider.apiKeyEnv);
}

export interface RemoteSettingsView {
  baseUrl: string;
  baseUrlSource: ValueSource;
  builderModel: string;
  builderModelSource: ValueSource;
  reviewerModel: string;
  reviewerModelSource: ValueSource;
  timeoutMs: number;
  apiKeyEnv: string;
  apiKeyConfigured: boolean;
  kind: ProviderKind;
}

/** Everything the Settings screen needs — and nothing secret. */
export function getRemoteSettings(): RemoteSettingsView {
  const baseUrl = remoteBaseUrl();
  return {
    baseUrl,
    baseUrlSource: remoteBaseUrlSource(),
    builderModel: remoteBuilderModel(),
    builderModelSource: remoteBuilderModelSource(),
    reviewerModel: remoteReviewerModel(),
    reviewerModelSource: remoteReviewerModelSource(),
    timeoutMs: remoteTimeoutMs(),
    apiKeyEnv: 'VISION_AI_API_KEY',
    apiKeyConfigured: (process.env.VISION_AI_API_KEY ?? '').length > 0,
    kind: inferProviderKind(baseUrl),
  };
}
