/** Small HTTP helpers shared by every model provider. */

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderHttpError(`Invalid JSON response from ${url}`, response.status, text.slice(0, 500));
  }
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderHttpError(
        `HTTP ${response.status} ${response.statusText} from ${url}`,
        response.status,
        body.slice(0, 500),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    throw new ProviderHttpError(describeNetworkError(error, url), null);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function describeNetworkError(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `Request to ${url} failed (${message}${cause})`;
}

/** Yield decoded lines from a streaming response body. */
export async function* readLines(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest.length > 0) yield rest;
  } finally {
    reader.releaseLock();
  }
}

export function joinUrl(base: string, suffix: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedSuffix = suffix.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedSuffix}`;
}
