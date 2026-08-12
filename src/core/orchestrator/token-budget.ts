import { getDb, asNumber, asText } from '@/core/db/database';
import { nowIso } from '@/core/util/id';
import type { AgentRole, RunMode } from '@/core/types';

/**
 * TOKEN BUDGET MANAGER
 *
 * A budget decides how much context a task may carry and how many council
 * rounds it may spend. Consumption is recorded per call so the cost of a task is
 * a measured number, not a guess — and when a provider does not report token
 * counts, the entry is marked `estimated` instead of being presented as exact.
 */

export type BudgetLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface Budget {
  level: BudgetLevel;
  /** Characters of repository context the task may carry. */
  contextChars: number;
  /** Upper bound on builder/reviewer rounds. */
  maxRounds: number;
  /** Roles allowed to run at this level. */
  roles: AgentRole[];
  /** Soft ceiling on total tokens; crossing it is reported, never silently ignored. */
  maxTotalTokens: number;
}

export const BUDGETS: Record<BudgetLevel, Budget> = {
  LOW: {
    level: 'LOW',
    contextChars: 24_000,
    maxRounds: 1,
    roles: ['builder'],
    maxTotalTokens: 20_000,
  },
  NORMAL: {
    level: 'NORMAL',
    contextChars: 60_000,
    maxRounds: 2,
    roles: ['planner', 'builder', 'reviewer'],
    maxTotalTokens: 60_000,
  },
  HIGH: {
    level: 'HIGH',
    contextChars: 100_000,
    maxRounds: 3,
    roles: ['planner', 'builder', 'reviewer'],
    maxTotalTokens: 150_000,
  },
  EXTREME: {
    level: 'EXTREME',
    contextChars: 120_000,
    maxRounds: 3,
    roles: ['planner', 'builder', 'reviewer'],
    maxTotalTokens: 400_000,
  },
};

const MODE_BUDGET: Record<RunMode, BudgetLevel> = {
  FAST: 'LOW',
  ENGINEER: 'NORMAL',
  DEEP_ANALYSIS: 'HIGH',
  ARCHITECT: 'HIGH',
  DEBUG: 'HIGH',
  TEAM: 'HIGH',
  EXTREME: 'EXTREME',
};

export function budgetForMode(mode: RunMode): Budget {
  return BUDGETS[MODE_BUDGET[mode]];
}

export function budgetForLevel(level: BudgetLevel): Budget {
  return BUDGETS[level];
}

/**
 * Rough token count for text. Four characters per token is the usual ratio for
 * source code in these tokenizers; it is only used where the provider reports
 * nothing, and such rows are flagged `estimated`.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface UsageEntry {
  taskId: string;
  role: AgentRole | string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  cached: boolean;
}

export function recordUsage(entry: UsageEntry): void {
  getDb()
    .prepare(
      `INSERT INTO token_usage (task_id, role, model, prompt_tokens, completion_tokens, estimated, cached, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.taskId,
      entry.role,
      entry.model,
      entry.promptTokens,
      entry.completionTokens,
      entry.estimated ? 1 : 0,
      entry.cached ? 1 : 0,
      nowIso(),
    );
}

export interface UsageSummary {
  taskId: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedCalls: number;
  /** True when any row was estimated rather than reported by the provider. */
  partlyEstimated: boolean;
}

export function usageForTask(taskId: string): UsageSummary {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(cached), 0) AS cached_calls,
              COALESCE(MAX(estimated), 0) AS any_estimated
       FROM token_usage WHERE task_id = ?`,
    )
    .get(taskId);

  const promptTokens = asNumber(row?.prompt_tokens);
  const completionTokens = asNumber(row?.completion_tokens);
  return {
    taskId,
    calls: asNumber(row?.calls),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedCalls: asNumber(row?.cached_calls),
    partlyEstimated: asNumber(row?.any_estimated) === 1,
  };
}

export interface UsageByModel {
  model: string;
  calls: number;
  totalTokens: number;
  cachedCalls: number;
}

export function usageByModel(limit = 20): UsageByModel[] {
  return getDb()
    .prepare(
      `SELECT model,
              COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(cached), 0) AS cached_calls
       FROM token_usage GROUP BY model ORDER BY total_tokens DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      model: asText(row.model),
      calls: asNumber(row.calls),
      totalTokens: asNumber(row.total_tokens),
      cachedCalls: asNumber(row.cached_calls),
    }));
}

/** Whether a task has already spent its allowance. */
export function budgetExceeded(taskId: string, budget: Budget): boolean {
  return usageForTask(taskId).totalTokens >= budget.maxTotalTokens;
}
