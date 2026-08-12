import { z } from 'zod';
import { handleError, ok, parseBody } from '../_lib/http';
import {
  getConfig,
  setAgents,
  setOrchestratorConfig,
  setProviders,
  providerCredentialsReady,
  getRemoteSettings,
  setRemoteOverride,
  clampTimeout,
} from '@/core/config/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const providerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['ollama', 'vllm', 'openai-compatible']),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().optional(),
  enabled: z.boolean(),
});

const agentSchema = z.object({
  role: z.enum(['planner', 'builder', 'reviewer', 'judge']),
  label: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(200_000),
});

/**
 * Remote GPU settings. The API key is intentionally absent: it is read from the
 * server environment and can never be set or read through this endpoint.
 */
const remoteSchema = z.object({
  baseUrl: z.string().max(500).optional(),
  builderModel: z.string().max(200).optional(),
  reviewerModel: z.string().max(200).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const bodySchema = z.object({
  remote: remoteSchema.optional(),
  providers: z.array(providerSchema).optional(),
  agents: z.array(agentSchema).optional(),
  orchestrator: z
    .object({
      maxRounds: z.number().int().min(1).max(10).optional(),
      defaultMode: z
        .enum(['FAST', 'ENGINEER', 'DEEP_ANALYSIS', 'ARCHITECT', 'DEBUG', 'TEAM', 'EXTREME'])
        .optional(),
      autoApplyPatches: z.boolean().optional(),
      runTestsAutomatically: z.boolean().optional(),
    })
    .optional(),
});

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    return ok({
      ...config,
      remote: getRemoteSettings(),
      // Never send secrets: only whether the env var backing a provider is present.
      providers: config.providers.map((provider) => ({
        ...provider,
        credentialsReady: providerCredentialsReady(provider),
      })),
    });
  } catch (error) {
    return handleError('api.settings', error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, bodySchema);
    if (body.remote) {
      setRemoteOverride({
        ...body.remote,
        timeoutMs: body.remote.timeoutMs === undefined ? undefined : clampTimeout(body.remote.timeoutMs),
      });
    }
    if (body.providers) setProviders(body.providers);
    if (body.agents) setAgents(body.agents);
    if (body.orchestrator) setOrchestratorConfig(body.orchestrator);
    return ok({ ...getConfig(), remote: getRemoteSettings() });
  } catch (error) {
    return handleError('api.settings', error);
  }
}
