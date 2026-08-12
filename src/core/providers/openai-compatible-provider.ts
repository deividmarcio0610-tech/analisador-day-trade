import type {
  ChatOptions,
  ChatResult,
  HealthReport,
  ModelDescriptor,
  ModelProvider,
  ProviderKind,
  StreamChunk,
} from '@/core/types';
import type { ProviderConfig } from '@/core/config/config';
import { DEFAULT_TIMEOUT_MS } from '@/core/config/config';
import { joinUrl, readLines, request, requestJson } from './http';
import { statusForFailure } from './failure';

interface OpenAiModelsResponse {
  data?: Array<{ id?: string; owned_by?: string }>;
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Provider for any endpoint speaking the OpenAI chat-completions dialect.
 * vLLM, llama.cpp server, LM Studio, TGI and hosted gateways all fit here.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  private readonly apiKeyEnv?: string;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.kind = config.kind === 'vllm' ? 'vllm' : 'openai-compatible';
    this.baseUrl = config.baseUrl;
    this.apiKeyEnv = config.apiKeyEnv;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const key = this.apiKeyEnv ? process.env[this.apiKeyEnv] : undefined;
    return key ? { authorization: `Bearer ${key}` } : {};
  }

  async health(signal?: AbortSignal): Promise<HealthReport> {
    const startedAt = Date.now();
    try {
      const models = await this.models(signal);
      return {
        status: 'ONLINE',
        latencyMs: Date.now() - startedAt,
        detail: `${models.length} model(s) available`,
        checkedAt: new Date().toISOString(),
        models: models.map((model) => model.id),
      };
    } catch (error) {
      return {
        status: statusForFailure(error),
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async models(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const data = await requestJson<OpenAiModelsResponse>(joinUrl(this.baseUrl, 'models'), {
      timeoutMs: PROBE_TIMEOUT_MS,
      headers: this.headers(),
      attempts: 2,
      signal,
    });
    return (data.data ?? [])
      .filter((model): model is { id: string; owned_by?: string } => typeof model.id === 'string')
      .map((model) => ({ id: model.id, provider: this.id, family: model.owned_by }));
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const startedAt = Date.now();
    const data = await requestJson<OpenAiChatResponse>(joinUrl(this.baseUrl, 'chat/completions'), {
      body: this.payload(options, false),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers: this.headers(),
      attempts: options.attempts ?? 3,
      signal: options.signal,
    });
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: options.model,
      reportedModel: data.model ?? null,
      provider: this.id,
      durationMs: Date.now() - startedAt,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
    };
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const response = await request(joinUrl(this.baseUrl, 'chat/completions'), {
      body: this.payload(options, true),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers: this.headers(),
      attempts: options.attempts ?? 3,
      signal: options.signal,
    });
    for await (const line of readLines(response)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        yield { delta: '', done: true };
        return;
      }
      let parsed: OpenAiChatResponse;
      try {
        parsed = JSON.parse(data) as OpenAiChatResponse;
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (delta) yield { delta, done: false };
    }
    yield { delta: '', done: true };
  }

  private payload(options: ChatOptions, stream: boolean) {
    return {
      model: options.model,
      messages: options.messages,
      stream,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
    };
  }
}
