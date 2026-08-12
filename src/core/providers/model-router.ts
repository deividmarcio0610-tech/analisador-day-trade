import type { AgentRole, ModelProvider } from '@/core/types';
import { getAgentConfig, type AgentConfig } from '@/core/config/config';
import { getProvider } from './registry';

/**
 * MODEL ROUTER
 *
 * Maps an engineering intent to a role, and a role to a concrete provider+model.
 * Callers never name a model family, so swapping the underlying models is a
 * settings change rather than a code change.
 */

export type Intent = 'coding' | 'reasoning' | 'debug' | 'review' | 'architecture' | 'tests';

const INTENT_TO_ROLE: Record<Intent, AgentRole> = {
  coding: 'builder',
  reasoning: 'reviewer',
  debug: 'reviewer',
  review: 'reviewer',
  architecture: 'planner',
  tests: 'builder',
};

export interface Route {
  role: AgentRole;
  config: AgentConfig;
  provider: ModelProvider;
}

export function roleForIntent(intent: Intent): AgentRole {
  return INTENT_TO_ROLE[intent];
}

export function routeRole(role: AgentRole): Route {
  const config = getAgentConfig(role);
  const provider = getProvider(config.providerId);
  return { role, config, provider };
}

export function routeIntent(intent: Intent): Route {
  return routeRole(roleForIntent(intent));
}
