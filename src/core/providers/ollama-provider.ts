import type {
  ChatOptions,
  ChatResult,
  HealthReport,
  ModelDescriptor,
  ModelProvider,
  StreamChunk,
} from '@/core/types';
import type { ProviderConfig } from '@/core/config/config';
import { DEFAULT_TIMEOUT_MS } from '@/core/config/config';
import { ProviderHttpError, joinUrl, readLines, request, requestJson } from './http';
import { statusForFailure } from './failure';

interface OllamaTagsResponse {
  models?: Array<{ name?: string; size?: number; details?: { family?: string } }>;
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
  error?: string;
}

const PROBE_TIMEOUT_MS = 8_000;

/** Provider for an Ollama daemon, local or remote (native /api endpoints). */
export class OllamaProvider implements ModelProvider {
  readonly id: string;
  readonly kind = 'ollama' as const;
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKeyEnv?: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiKeyEnv = config.apiKeyEnv;
  }

  /** A remote Ollama behind a proxy may still require a bearer token. */
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
    const data = await requestJson<OllamaTagsResponse>(joinUrl(this.baseUrl, 'api/tags'), {
      timeoutMs: PROBE_TIMEOUT_MS,
      headers: this.headers(),
      attempts: 2,
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
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers: this.headers(),
      attempts: options.attempts ?? 3,
      signal: options.signal,
    });

    // Ollama answers 200 with an `error` field when a model is missing.
    if (data.error) {
      throw new ProviderHttpError(`Ollama refused the request: ${data.error}`, 200, 'not-found');
    }

    return {
      content: data.message?.content ?? '',
      model: options.model,
      reportedModel: data.model ?? null,
      provider: this.id,
      durationMs: Date.now() - startedAt,
      promptTokens: data.prompt_eval_count ?? null,
      completionTokens: data.eval_count ?? null,
    };
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const response = await request(joinUrl(this.baseUrl, 'api/chat'), {
      body: this.payload(options, true),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers: this.headers(),
      attempts: options.attempts ?? 3,
      signal: options.signal,
    });

    for await (const line of readLines(response)) {
      let parsed: OllamaChatResponse;
      try {
        parsed = JSON.parse(line) as OllamaChatResponse;
      } catch {
        throw new ProviderHttpError(
          `Malformed stream chunk from Ollama: ${line.slice(0, 200)}`,
          null,
          'protocol',
        );
      }
      if (parsed.error) {
        throw new ProviderHttpError(`Ollama refused the request: ${parsed.error}`, 200, 'not-found');
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
