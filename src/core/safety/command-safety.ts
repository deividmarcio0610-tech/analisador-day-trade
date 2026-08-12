import type { CommandRisk } from '@/core/types';

/**
 * COMMAND SAFETY
 *
 * Classifies a shell command line before it runs. CRITICAL commands require an
 * explicit confirmation flag from the caller; the agent can never self-approve.
 */

export interface SafetyVerdict {
  risk: CommandRisk;
  reasons: string[];
}

interface Rule {
  risk: Exclude<CommandRisk, 'SAFE'>;
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  { risk: 'CRITICAL', pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, reason: 'recursive/forced delete' },
  { risk: 'CRITICAL', pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'filesystem format' },
  { risk: 'CRITICAL', pattern: /\bdd\s+if=/i, reason: 'raw disk write' },
  { risk: 'CRITICAL', pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'host power state change' },
  { risk: 'CRITICAL', pattern: /\bgit\s+push\b[^|;]*(--force\b|-f\b)/i, reason: 'force push rewrites remote history' },
  { risk: 'CRITICAL', pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'discards working tree changes' },
  { risk: 'CRITICAL', pattern: /\bgit\s+clean\s+-[a-z]*f/i, reason: 'deletes untracked files' },
  { risk: 'CRITICAL', pattern: /\bdrop\s+(database|table|schema)\b/i, reason: 'destructive SQL' },
  { risk: 'CRITICAL', pattern: /\btruncate\s+table\b/i, reason: 'destructive SQL' },
  { risk: 'CRITICAL', pattern: /\bdocker\s+(system\s+prune|volume\s+rm|rm\s+-f)/i, reason: 'removes containers/volumes' },
  { risk: 'CRITICAL', pattern: /\bkubectl\s+delete\b/i, reason: 'deletes cluster resources' },
  { risk: 'CRITICAL', pattern: /\bchmod\s+(-R\s+)?777\b/i, reason: 'world-writable permissions' },
  { risk: 'CRITICAL', pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: 'pipes remote script into a shell' },
  { risk: 'CRITICAL', pattern: /\bnpm\s+publish\b/i, reason: 'publishes a package' },
  { risk: 'CRITICAL', pattern: /\bsudo\b/i, reason: 'privilege escalation' },
  { risk: 'CRITICAL', pattern: /\b(shred|>\s*\/dev\/[sh]d[a-z])/i, reason: 'destroys data' },

  { risk: 'REVIEW', pattern: /\brm\b/i, reason: 'deletes files' },
  { risk: 'REVIEW', pattern: /\bmv\b/i, reason: 'moves files' },
  { risk: 'REVIEW', pattern: /\bgit\s+(push|commit|merge|rebase|checkout|switch|restore|stash|worktree)\b/i, reason: 'mutates repository state' },
  { risk: 'REVIEW', pattern: /\b(npm|pnpm|yarn)\s+(install|i|add|remove|uninstall|update|ci)\b/i, reason: 'changes dependencies' },
  { risk: 'REVIEW', pattern: /\bpip3?\s+(install|uninstall)\b/i, reason: 'changes dependencies' },
  { risk: 'REVIEW', pattern: /\b(apt|apt-get|yum|dnf|brew|apk)\b/i, reason: 'system package manager' },
  { risk: 'REVIEW', pattern: /\bdocker\b/i, reason: 'container runtime operation' },
  { risk: 'REVIEW', pattern: /\bssh\b/i, reason: 'remote host access' },
  { risk: 'REVIEW', pattern: /\bscp\b|\brsync\b/i, reason: 'file transfer' },
  { risk: 'REVIEW', pattern: /\b(curl|wget)\b/i, reason: 'network request' },
  { risk: 'REVIEW', pattern: /\bkill(all)?\b/i, reason: 'terminates processes' },
  { risk: 'REVIEW', pattern: />>?\s*[^|&\s]+/, reason: 'redirects output into a file' },
  { risk: 'REVIEW', pattern: /\bchmod\b|\bchown\b/i, reason: 'changes permissions' },
];

export function classifyCommand(commandLine: string): SafetyVerdict {
  const normalized = commandLine.trim();
  if (normalized.length === 0) return { risk: 'REVIEW', reasons: ['empty command'] };

  const critical: string[] = [];
  const review: string[] = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(normalized)) continue;
    if (rule.risk === 'CRITICAL') critical.push(rule.reason);
    else review.push(rule.reason);
  }

  if (critical.length > 0) return { risk: 'CRITICAL', reasons: critical };
  if (review.length > 0) return { risk: 'REVIEW', reasons: review };
  return { risk: 'SAFE', reasons: [] };
}

export function requiresConfirmation(risk: CommandRisk): boolean {
  return risk === 'CRITICAL';
}
