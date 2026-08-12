import type { AgentRole, ChatMessage, ChatResult } from '@/core/types';
import { routeRole } from '@/core/providers/model-router';
import { ProviderNotConfiguredError } from '@/core/providers/registry';
import { finishAgentRun, startAgentRun } from '@/core/db/agent-run-repo';
import { logger } from '@/core/logging/logger';
import { getDb } from '@/core/db/database';
import { nowIso } from '@/core/util/id';

/**
 * Executes one agent turn against whichever provider the router resolves.
 * Streams deltas to the caller and records the run for the router statistics.
 */

export interface AgentTurnOptions {
  role: AgentRole;
  system: string;
  user: string;
  taskId: string;
  round: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  history?: ChatMessage[];
}

export class AgentUnavailableError extends Error {
  constructor(readonly role: AgentRole, readonly reason: string) {
    super(`Agent "${role}" is unavailable: ${reason}`);
    this.name = 'AgentUnavailableError';
  }
}

export async function runAgentTurn(options: AgentTurnOptions): Promise<ChatResult> {
  let route;
  try {
    route = routeRole(options.role);
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      throw new AgentUnavailableError(options.role, error.message);
    }
    throw error;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    ...(options.history ?? []),
    { role: 'user', content: options.user },
  ];

  const runId = startAgentRun({
    taskId: options.taskId,
    role: options.role,
    provider: route.provider.id,
    model: route.config.model,
    round: options.round,
  });
  const startedAt = Date.now();

  persistMessage(options.taskId, `${options.role}:input`, options.user);
  logger.agent('agent', `${options.role} → ${route.provider.id}/${route.config.model}`, {
    taskId: options.taskId,
    agent: options.role,
  });

  try {
    let content = '';
    if (options.onDelta) {
      for await (const chunk of route.provider.stream({
        model: route.config.model,
        messages,
        temperature: route.config.temperature,
        maxTokens: route.config.maxTokens,
        signal: options.signal,
      })) {
        if (chunk.delta) {
          content += chunk.delta;
          options.onDelta(chunk.delta);
        }
        if (chunk.done) break;
      }
    } else {
      const result = await route.provider.chat({
        model: route.config.model,
        messages,
        temperature: route.config.temperature,
        maxTokens: route.config.maxTokens,
        signal: options.signal,
      });
      content = result.content;
      finishAgentRun(runId, {
        status: 'ok',
        durationMs: result.durationMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      persistMessage(options.taskId, `${options.role}:output`, content);
      return result;
    }

    const durationMs = Date.now() - startedAt;
    finishAgentRun(runId, { status: 'ok', durationMs });
    persistMessage(options.taskId, `${options.role}:output`, content);
    return {
      content,
      model: route.config.model,
      // Streaming chunks do not carry a model id in either dialect.
      reportedModel: null,
      provider: route.provider.id,
      durationMs,
      promptTokens: null,
      completionTokens: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishAgentRun(runId, { status: 'error', durationMs: Date.now() - startedAt, error: message });
    logger.error('agent', `${options.role} failed: ${message}`, {
      taskId: options.taskId,
      agent: options.role,
    });
    throw error;
  }
}

function persistMessage(taskId: string, role: string, content: string): void {
  getDb()
    .prepare('INSERT INTO messages (task_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(taskId, role, content, nowIso());
}

export interface StoredMessage {
  id: number;
  taskId: string;
  role: string;
  content: string;
  createdAt: string;
}

export function listMessages(taskId: string): StoredMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY id ASC LIMIT 500')
    .all(taskId);
  return rows.map((row) => ({
    id: Number(row.id),
    taskId: String(row.task_id),
    role: String(row.role),
    content: String(row.content),
    createdAt: String(row.created_at),
  }));
}
