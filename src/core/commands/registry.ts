import type { RunMode } from '@/core/types';

/**
 * NATIVE COMMANDS
 *
 * Two families:
 *  - `orchestrated` commands start a job that runs through the council.
 *  - `tool` commands execute deterministically on the server and return data.
 *
 * The prompt bar parses `/name rest of the prompt` against this registry.
 */

export type CommandKind = 'orchestrated' | 'tool';

export interface CommandSpec {
  name: string;
  kind: CommandKind;
  mode?: RunMode;
  /** Apply the resulting patch and run the verification suite automatically. */
  verify?: boolean;
  summary: string;
  usage: string;
  requiresPrompt: boolean;
}

export const COMMANDS: CommandSpec[] = [
  {
    name: 'solve',
    kind: 'orchestrated',
    mode: 'ENGINEER',
    summary: 'Understand → context → reproduce → hypotheses → root cause → patch → review → tests.',
    usage: '/solve <what should be solved>',
    requiresPrompt: true,
  },
  {
    name: 'debug',
    kind: 'orchestrated',
    mode: 'DEBUG',
    summary: 'Hypothesis board driven by real evidence, then a targeted fix.',
    usage: '/debug <symptom, stack trace or failing behaviour>',
    requiresPrompt: true,
  },
  {
    name: 'architect',
    kind: 'orchestrated',
    mode: 'ARCHITECT',
    summary: 'Design first: requirements, architecture and implementation order. No code.',
    usage: '/architect <what should be designed>',
    requiresPrompt: true,
  },
  {
    name: 'research',
    kind: 'orchestrated',
    mode: 'DEEP_ANALYSIS',
    summary: 'Deep read of the codebase to answer a question with file-level evidence.',
    usage: '/research <question about the codebase>',
    requiresPrompt: true,
  },
  {
    name: 'review',
    kind: 'orchestrated',
    mode: 'ENGINEER',
    summary: 'Independent review of the current working tree changes.',
    usage: '/review [focus]',
    requiresPrompt: false,
  },
  {
    name: 'challenge',
    kind: 'orchestrated',
    mode: 'DEEP_ANALYSIS',
    summary: 'Adversarial round: the reviewer actively looks for reasons to reject the patch.',
    usage: '/challenge <what to challenge>',
    requiresPrompt: true,
  },
  {
    name: 'prove',
    kind: 'tool',
    summary: 'Evidence report for a job: problem, root cause, files, tests, before/after, status.',
    usage: '/prove [jobId]',
    requiresPrompt: false,
  },
  {
    name: 'compare',
    kind: 'orchestrated',
    mode: 'EXTREME',
    summary: 'Two independent solutions, cross reviewed and compared on measured results.',
    usage: '/compare <problem to solve two ways>',
    requiresPrompt: true,
  },
  {
    name: 'lab',
    kind: 'orchestrated',
    mode: 'EXTREME',
    verify: true,
    summary: 'Experiments in isolated worktrees; the best one is kept, main stays untouched.',
    usage: '/lab <experiment>',
    requiresPrompt: true,
  },
  {
    name: 'finalize',
    kind: 'tool',
    summary: 'Sweep for errors, pending markers and broken checks, then report what is missing.',
    usage: '/finalize',
    requiresPrompt: false,
  },
  {
    name: 'audit',
    kind: 'tool',
    summary: 'Technical debt, secrets, API contract and defensive security review.',
    usage: '/audit',
    requiresPrompt: false,
  },
  {
    name: 'test',
    kind: 'tool',
    summary: 'Run the project test suite and record the result as evidence.',
    usage: '/test',
    requiresPrompt: false,
  },
  {
    name: 'build',
    kind: 'tool',
    summary: 'Run the project build and record the result as evidence.',
    usage: '/build',
    requiresPrompt: false,
  },
  {
    name: 'status',
    kind: 'tool',
    summary: 'Jobs, running processes and workspace state.',
    usage: '/status',
    requiresPrompt: false,
  },
  {
    name: 'health',
    kind: 'tool',
    summary: 'Project health from measured signals only.',
    usage: '/health',
    requiresPrompt: false,
  },
  {
    name: 'git',
    kind: 'tool',
    summary: 'Status, diff, log, branches, stashes, worktrees and checkpoints.',
    usage: '/git',
    requiresPrompt: false,
  },
  {
    name: 'database',
    kind: 'tool',
    summary: 'Schema, indexes, foreign keys, integrity and N+1 patterns.',
    usage: '/database',
    requiresPrompt: false,
  },
  {
    name: 'performance',
    kind: 'tool',
    summary: 'Host metrics, recorded run durations and bundle sizes.',
    usage: '/performance',
    requiresPrompt: false,
  },
  {
    name: 'vps',
    kind: 'tool',
    summary: 'Authorised SSH connections and their reachability.',
    usage: '/vps',
    requiresPrompt: false,
  },
  {
    name: 'gpu',
    kind: 'tool',
    summary: 'GPU devices and inference endpoint status.',
    usage: '/gpu',
    requiresPrompt: false,
  },
];

export function findCommand(name: string): CommandSpec | null {
  const normalized = name.replace(/^\//, '').toLowerCase();
  return COMMANDS.find((command) => command.name === normalized) ?? null;
}

export interface ParsedCommand {
  command: CommandSpec | null;
  rest: string;
  raw: string;
  error: string | null;
}

/** Parse a prompt bar entry. Text without a leading slash is a free-form request. */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { command: null, rest: trimmed, raw: trimmed, error: null };
  }
  const [head = '', ...tail] = trimmed.split(/\s+/);
  const command = findCommand(head);
  const rest = tail.join(' ').trim();
  if (!command) {
    return { command: null, rest, raw: trimmed, error: `Unknown command: ${head}` };
  }
  if (command.requiresPrompt && rest.length === 0) {
    return { command, rest, raw: trimmed, error: `${head} needs an argument. Usage: ${command.usage}` };
  }
  return { command, rest, raw: trimmed, error: null };
}
