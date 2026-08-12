/** Small HTTP helpers shared by every model provider. */

/** Why a provider call failed. Drives the health state and the retry decision. */
export type FailureKind = 'unreachable' | 'timeout' | 'auth' | 'not-found' | 'server' | 'protocol';

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: FailureKind,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }

  /** Temporary conditions are worth retrying; a rejected key or a missing model is not. */
  get retryable(): boolean {
    return this.kind === 'unreachable' || this.kind === 'timeout' || this.kind === 'server';
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
  /** Attempts for retryable failures (1 = no retry). */
  attempts?: number;
  /** Base delay for the exponential backoff, in milliseconds. */
  retryBaseMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: ProviderHttpError) => void;
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderHttpError(
      `Invalid JSON response from ${url}`,
      response.status,
      'protocol',
      text.slice(0, 500),
    );
  }
}

/**
 * Single HTTP attempt. Every failure mode is mapped to a `FailureKind` so the
 * caller can tell "the box is down" from "the box said no".
 */
async function attempt(url: string, options: RequestOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);
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
        classifyStatus(response.status),
        body.slice(0, 500),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (timedOut) {
      throw new ProviderHttpError(`Request to ${url} timed out after ${timeoutMs}ms`, null, 'timeout');
    }
    if (options.signal?.aborted) {
      throw new ProviderHttpError(`Request to ${url} was cancelled`, null, 'timeout');
    }
    throw new ProviderHttpError(describeNetworkError(error, url), null, 'unreachable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * HTTP with exponential backoff. A remote GPU host can drop a connection while
 * it is loading a model or being rescheduled, so temporary failures are retried
 * instead of taking the platform down; permanent ones fail immediately.
 */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 1);
  const baseDelay = options.retryBaseMs ?? 500;
  let lastError: ProviderHttpError | null = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await attempt(url, options);
    } catch (error) {
      const failure =
        error instanceof ProviderHttpError
          ? error
          : new ProviderHttpError(String(error), null, 'unreachable');
      lastError = failure;

      const isLast = index === attempts - 1;
      if (isLast || !failure.retryable || options.signal?.aborted) throw failure;

      // Exponential backoff with jitter, so parallel agents do not retry in lockstep.
      const delay = Math.round(baseDelay * 2 ** index * (0.75 + Math.random() * 0.5));
      options.onRetry?.(index + 1, delay, failure);
      await sleep(delay, options.signal);
    }
  }

  throw lastError ?? new ProviderHttpError(`Request to ${url} failed`, null, 'unreachable');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ProviderHttpError('Cancelled while waiting to retry', null, 'timeout'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function classifyStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not-found';
  if (status === 408 || status === 429) return 'server';
  if (status >= 500) return 'server';
  return 'protocol';
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

/**
 * Mask an endpoint for display: the shape stays readable, the host and port do
 * not leak. Credentials embedded in a URL are removed entirely.
 */
export function maskEndpoint(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = maskHost(parsed.hostname);
    const port = parsed.port ? `:${maskPort(parsed.port)}` : '';
    return `${parsed.protocol}//${host}${port}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return '***';
  }
}

function maskHost(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 1) return `${hostname.slice(0, 2)}***`;
  const head = parts[0] ?? '';
  const tail = parts.slice(1).join('.');
  return `${head.slice(0, 2)}***.${tail}`;
}

function maskPort(port: string): string {
  return port.length <= 2 ? '**' : `${port.slice(0, 2)}**`;
}
