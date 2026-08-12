import type { RunMode } from '@/core/types';

/** Behaviour profile of each run mode. */
export interface ModeProfile {
  mode: RunMode;
  label: string;
  description: string;
  plan: boolean;
  challengeReview: boolean;
  maxRounds: number;
  contextBudget: number;
  tournament: boolean;
  requireRootCause: boolean;
}

export const MODE_PROFILES: Record<RunMode, ModeProfile> = {
  FAST: {
    mode: 'FAST',
    label: 'Fast',
    description: 'Single builder pass, one review, smallest context.',
    plan: false,
    challengeReview: false,
    maxRounds: 1,
    contextBudget: 24_000,
    tournament: false,
    requireRootCause: false,
  },
  ENGINEER: {
    mode: 'ENGINEER',
    label: 'Engineer',
    description: 'Plan, build, review, revise. The default working mode.',
    plan: true,
    challengeReview: false,
    maxRounds: 2,
    contextBudget: 60_000,
    tournament: false,
    requireRootCause: false,
  },
  DEEP_ANALYSIS: {
    mode: 'DEEP_ANALYSIS',
    label: 'Deep Analysis',
    description: 'Adversarial review, root cause required, up to three rounds.',
    plan: true,
    challengeReview: true,
    maxRounds: 3,
    contextBudget: 100_000,
    tournament: false,
    requireRootCause: true,
  },
  ARCHITECT: {
    mode: 'ARCHITECT',
    label: 'Architect',
    description: 'Design only: requirements, architecture and implementation order.',
    plan: true,
    challengeReview: false,
    maxRounds: 1,
    contextBudget: 80_000,
    tournament: false,
    requireRootCause: false,
  },
  DEBUG: {
    mode: 'DEBUG',
    label: 'Debug',
    description: 'Hypothesis board driven by evidence, then a targeted fix.',
    plan: false,
    challengeReview: true,
    maxRounds: 2,
    contextBudget: 80_000,
    tournament: false,
    requireRootCause: true,
  },
  TEAM: {
    mode: 'TEAM',
    label: 'Team',
    description: 'Full council with three review rounds.',
    plan: true,
    challengeReview: true,
    maxRounds: 3,
    contextBudget: 100_000,
    tournament: false,
    requireRootCause: false,
  },
  EXTREME: {
    mode: 'EXTREME',
    label: 'Extreme',
    description: 'Two independent solutions, cross review, evidence decides.',
    plan: true,
    challengeReview: true,
    maxRounds: 3,
    contextBudget: 120_000,
    tournament: true,
    requireRootCause: true,
  },
};

export function profileFor(mode: RunMode): ModeProfile {
  return MODE_PROFILES[mode];
}

export const RUN_MODES: RunMode[] = [
  'FAST',
  'ENGINEER',
  'DEEP_ANALYSIS',
  'ARCHITECT',
  'DEBUG',
  'TEAM',
  'EXTREME',
];
