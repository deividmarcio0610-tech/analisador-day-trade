import type { z } from 'zod';
import { runAgentTurn, type AgentTurnOptions } from './agent-runtime';
import {
  architectSchema,
  debugSchema,
  patchSchema,
  planSchema,
  reviewSchema,
  type ArchitectPayload,
  type DebugPayload,
  type PatchPayload,
  type PlanPayload,
  type ReviewPayload,
} from './schemas';
import {
  ARCHITECT_SYSTEM,
  BUILDER_SYSTEM,
  CHALLENGER_SYSTEM,
  DEBUG_SYSTEM,
  PLANNER_SYSTEM,
  REVIEWER_SYSTEM,
} from './prompts';
import { extractJson } from '@/core/util/text';

/**
 * Typed council calls. Each one asks a role for JSON, validates it, and retries
 * once with the parser error appended — a model that cannot produce valid output
 * twice is an error, not something to paper over.
 */

export class AgentOutputError extends Error {
  constructor(
    readonly role: string,
    readonly detail: string,
    readonly raw: string,
  ) {
    super(`Agent "${role}" returned unusable output: ${detail}`);
    this.name = 'AgentOutputError';
  }
}

interface StructuredOptions extends Omit<AgentTurnOptions, 'system'> {
  system: string;
}

async function structured<S extends z.ZodTypeAny>(
  schema: S,
  options: StructuredOptions,
): Promise<{ value: z.infer<S>; raw: string }> {
  let lastRaw = '';
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user =
      attempt === 0
        ? options.user
        : `${options.user}\n\nYour previous answer could not be parsed (${lastError}).\nReturn ONLY the JSON object described in the system prompt.`;

    const result = await runAgentTurn({ ...options, user });
    lastRaw = result.content;

    const json = extractJson<unknown>(result.content);
    if (json === null) {
      lastError = 'no JSON object found in the response';
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return { value: parsed.data, raw: result.content };
    lastError = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
  }

  throw new AgentOutputError(options.role, lastError, lastRaw);
}

export function runPlanner(
  options: Omit<StructuredOptions, 'system' | 'role'>,
): Promise<{ value: PlanPayload; raw: string }> {
  return structured(planSchema, { ...options, role: 'planner', system: PLANNER_SYSTEM });
}

export function runBuilder(
  options: Omit<StructuredOptions, 'system' | 'role'>,
): Promise<{ value: PatchPayload; raw: string }> {
  return structured(patchSchema, { ...options, role: 'builder', system: BUILDER_SYSTEM });
}

export function runReviewer(
  options: Omit<StructuredOptions, 'system' | 'role'> & { challenge?: boolean },
): Promise<{ value: ReviewPayload; raw: string }> {
  const { challenge, ...rest } = options;
  return structured(reviewSchema, {
    ...rest,
    role: 'reviewer',
    system: challenge ? CHALLENGER_SYSTEM : REVIEWER_SYSTEM,
  });
}

export function runDebugAnalysis(
  options: Omit<StructuredOptions, 'system' | 'role'>,
): Promise<{ value: DebugPayload; raw: string }> {
  return structured(debugSchema, { ...options, role: 'reviewer', system: DEBUG_SYSTEM });
}

export function runArchitect(
  options: Omit<StructuredOptions, 'system' | 'role'>,
): Promise<{ value: ArchitectPayload; raw: string }> {
  return structured(architectSchema, { ...options, role: 'planner', system: ARCHITECT_SYSTEM });
}
