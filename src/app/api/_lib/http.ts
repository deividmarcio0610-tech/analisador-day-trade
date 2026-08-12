import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/core/logging/logger';
import { CommandBlockedError } from '@/core/tools/process-runner';
import { PathEscapeError } from '@/core/paths';
import { ProviderNotConfiguredError } from '@/core/providers/registry';
import { AgentUnavailableError } from '@/core/agents/agent-runtime';

/** Shared helpers for the Vision HTTP API. */

export const dynamic = 'force-dynamic';

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Maps domain errors to honest status codes; unknown errors are 500 with the real message. */
export function handleError(scope: string, error: unknown): NextResponse {
  if (error instanceof PathEscapeError) return fail(error.message, 403);
  if (error instanceof CommandBlockedError) {
    return fail(error.message, 403, { risk: 'CRITICAL', reasons: error.reasons, requiresConfirmation: true });
  }
  if (error instanceof ProviderNotConfiguredError || error instanceof AgentUnavailableError) {
    return fail(error.message, 503, { status: 'NOT_CONFIGURED' });
  }
  if (error instanceof z.ZodError) {
    return fail(
      `Invalid request: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      422,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error(scope, message);
  return fail(message, 500);
}

export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'request body must be valid JSON',
      },
    ]);
  }
  return schema.parse(raw);
}

export function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

/** Server-Sent Events stream helper with heartbeats. */
export function sseResponse(
  start: (send: (event: string, data: unknown) => void, close: () => void) => (() => void) | void,
): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | void;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (typeof cleanup === 'function') cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      cleanup = start(send, close);
      heartbeat = setInterval(() => send('ping', { at: new Date().toISOString() }), 20_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (typeof cleanup === 'function') cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
