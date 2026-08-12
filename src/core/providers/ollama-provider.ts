import type {
  ChatOptions,
  ChatResult,
  HealthReport,
  ModelDescriptor,
  ModelProvider,
  StreamChunk,
} from '@/core/types';
import type { ProviderConfig } from '@/core/config/config';
import { ProviderHttpError, joinUrl, readLines, request, requestJson } from './http';

interface OllamaTagsResponse {
  models?: Array<{ name?: string; size?: number; details?: { family?: string } }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
}

/** Provider for a local Ollama daemon (native /api endpoints). */
export class OllamaProvider implements ModelProvider {
  readonly id: string;
  readonly kind = 'ollama' as const;
  readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl;
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
        status: 'OFFLINE',
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async models(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const data = await requestJson<OllamaTagsResponse>(joinUrl(this.baseUrl, 'api/tags'), {
      timeoutMs: 5_000,
      signal,
    });
    return (data.models ?? [])
      .filter((model): model is { name: string; size?: number; details?: { family?: string } } =>
        typeof model.name === 'string',
      )
      .map((model) => ({
        id: model.name,
        provider: this.id,
        sizeBytes: model.size,
        family: model.details?.family,
      }));
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const startedAt = Date.now();
    const data = await requestJson<OllamaChatResponse>(joinUrl(this.baseUrl, 'api/chat'), {
      body: this.payload(options, false),
      timeoutMs: 600_000,
      signal: options.signal,
    });
    return {
      content: data.message?.content ?? '',
      model: options.model,
      provider: this.id,
      durationMs: Date.now() - startedAt,
      promptTokens: data.prompt_eval_count ?? null,
      completionTokens: data.eval_count ?? null,
    };
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const response = await request(joinUrl(this.baseUrl, 'api/chat'), {
      body: this.payload(options, true),
      timeoutMs: 600_000,
      signal: options.signal,
    });
    for await (const line of readLines(response)) {
      let parsed: OllamaChatResponse;
      try {
        parsed = JSON.parse(line) as OllamaChatResponse;
      } catch {
        throw new ProviderHttpError(`Malformed stream chunk from Ollama: ${line.slice(0, 200)}`, null);
      }
      const delta = parsed.message?.content ?? '';
      if (delta) yield { delta, done: false };
      if (parsed.done) {
        yield { delta: '', done: true };
        return;
      }
    }
    yield { delta: '', done: true };
  }

  private payload(options: ChatOptions, stream: boolean) {
    return {
      model: options.model,
      messages: options.messages,
      stream,
      options: {
        temperature: options.temperature ?? 0.2,
        num_predict: options.maxTokens ?? 4096,
      },
    };
  }
}
