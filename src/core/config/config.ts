import { getSetting, setSetting } from '@/core/db/settings-repo';
import type { AgentRole, ProviderKind, RunMode } from '@/core/types';

/**
 * Runtime configuration.
 *
 * Defaults are conservative: local Ollama endpoints, Qwen as builder and
 * DeepSeek as reviewer. Everything is editable from Settings and persisted in
 * SQLite. API keys are NEVER stored here — only the name of an environment
 * variable that the server reads at call time.
 */

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Name of the env var holding the API key (server side only). */
  apiKeyEnv?: string;
  enabled: boolean;
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

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'ollama-local',
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    enabled: true,
  },
  {
    id: 'vllm-local',
    label: 'vLLM (local)',
    kind: 'vllm',
    baseUrl: process.env.VLLM_BASE_URL ?? 'http://127.0.0.1:8000/v1',
    apiKeyEnv: 'VLLM_API_KEY',
    enabled: false,
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    kind: 'openai-compatible',
    baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://127.0.0.1:8080/v1',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    enabled: false,
  },
];

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    role: 'planner',
    label: 'Planner',
    providerId: 'ollama-local',
    model: 'qwen2.5-coder:14b',
    temperature: 0.2,
    maxTokens: 4096,
  },
  {
    role: 'builder',
    label: 'Builder',
    providerId: 'ollama-local',
    model: 'qwen2.5-coder:14b',
    temperature: 0.1,
    maxTokens: 8192,
  },
  {
    role: 'reviewer',
    label: 'Reviewer',
    providerId: 'ollama-local',
    model: 'deepseek-r1:14b',
    temperature: 0.2,
    maxTokens: 8192,
  },
  {
    role: 'judge',
    label: 'Judge',
    providerId: 'ollama-local',
    model: 'deepseek-r1:14b',
    temperature: 0,
    maxTokens: 4096,
  },
];

export const DEFAULT_ORCHESTRATOR: OrchestratorConfig = {
  maxRounds: 3,
  defaultMode: 'ENGINEER',
  autoApplyPatches: false,
  runTestsAutomatically: true,
};

const KEY_PROVIDERS = 'providers';
const KEY_AGENTS = 'agents';
const KEY_ORCHESTRATOR = 'orchestrator';

export function getProviders(): ProviderConfig[] {
  const stored = getSetting<ProviderConfig[] | null>(KEY_PROVIDERS, null);
  if (!stored || stored.length === 0) return DEFAULT_PROVIDERS;
  return stored;
}

export function setProviders(providers: ProviderConfig[]): void {
  setSetting(KEY_PROVIDERS, providers);
}

export function getAgents(): AgentConfig[] {
  const stored = getSetting<AgentConfig[] | null>(KEY_AGENTS, null);
  if (!stored || stored.length === 0) return DEFAULT_AGENTS;
  // Merge so a newly introduced role is never missing.
  return DEFAULT_AGENTS.map(
    (fallback) => stored.find((agent) => agent.role === fallback.role) ?? fallback,
  );
}

export function setAgents(agents: AgentConfig[]): void {
  setSetting(KEY_AGENTS, agents);
}

export function getAgentConfig(role: AgentRole): AgentConfig {
  const found = getAgents().find((agent) => agent.role === role);
  if (found) return found;
  const fallback = DEFAULT_AGENTS.find((agent) => agent.role === role);
  if (!fallback) throw new Error(`No configuration for agent role "${role}"`);
  return fallback;
}

export function getProviderConfig(id: string): ProviderConfig | null {
  return getProviders().find((provider) => provider.id === id) ?? null;
}

export function getOrchestratorConfig(): OrchestratorConfig {
  return { ...DEFAULT_ORCHESTRATOR, ...getSetting<Partial<OrchestratorConfig>>(KEY_ORCHESTRATOR, {}) };
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
