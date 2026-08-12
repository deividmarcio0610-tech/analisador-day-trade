import type { HealthReport, ModelProvider } from '@/core/types';
import {
  getProviderConfig,
  getProviders,
  providerCredentialsReady,
  type ProviderConfig,
} from '@/core/config/config';
import { OllamaProvider } from './ollama-provider';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';

/**
 * Provider factory. Nothing in the UI or the agents constructs a provider
 * directly — they resolve one by id so the concrete backend stays swappable.
 */

export function createProvider(config: ProviderConfig): ModelProvider {
  switch (config.kind) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'vllm':
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(config);
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(readonly providerId: string, readonly reason: string) {
    super(`Provider "${providerId}" is not configured: ${reason}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export function getProvider(id: string): ModelProvider {
  const config = getProviderConfig(id);
  if (!config) throw new ProviderNotConfiguredError(id, 'unknown provider id');
  if (!config.enabled) throw new ProviderNotConfiguredError(id, 'provider disabled in settings');
  if (!providerCredentialsReady(config)) {
    throw new ProviderNotConfiguredError(
      id,
      `environment variable ${config.apiKeyEnv} is not set`,
    );
  }
  return createProvider(config);
}

export interface ProviderStatus {
  id: string;
  label: string;
  kind: string;
  baseUrl: string;
  enabled: boolean;
  health: HealthReport;
}

/** Health of every configured provider. Disabled ones report NOT_CONFIGURED. */
export async function providerStatuses(signal?: AbortSignal): Promise<ProviderStatus[]> {
  const configs = getProviders();
  return Promise.all(
    configs.map(async (config): Promise<ProviderStatus> => {
      const base = {
        id: config.id,
        label: config.label,
        kind: config.kind,
        baseUrl: config.baseUrl,
        enabled: config.enabled,
      };
      if (!config.enabled) {
        return {
          ...base,
          health: notConfigured('provider disabled in settings'),
        };
      }
      if (!providerCredentialsReady(config)) {
        return {
          ...base,
          health: notConfigured(`environment variable ${config.apiKeyEnv} is not set`),
        };
      }
      const provider = createProvider(config);
      return { ...base, health: await provider.health(signal) };
    }),
  );
}

function notConfigured(detail: string): HealthReport {
  return {
    status: 'NOT_CONFIGURED',
    latencyMs: null,
    detail,
    checkedAt: new Date().toISOString(),
  };
}
