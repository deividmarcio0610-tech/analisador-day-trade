import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, isProbablyBinary } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';

/**
 * SECRET GUARD
 *
 * Flags likely credentials committed to the workspace. The matched value is
 * never returned in full — only a masked preview — so the UI and the logs
 * cannot leak what they are warning about.
 */

export interface SecretFinding {
  path: string;
  line: number;
  kind: string;
  masked: string;
  confidence: 'high' | 'medium' | 'low';
}

interface SecretRule {
  kind: string;
  pattern: RegExp;
  confidence: SecretFinding['confidence'];
}

const RULES: SecretRule[] = [
  { kind: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/, confidence: 'high' },
  { kind: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, confidence: 'high' },
  { kind: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, confidence: 'high' },
  { kind: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, confidence: 'high' },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, confidence: 'high' },
  { kind: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, confidence: 'medium' },
  {
    kind: 'Generic API key assignment',
    pattern: /\b(api[_-]?key|apikey|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    confidence: 'medium',
  },
  {
    kind: 'Connection string with credentials',
    pattern: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:'"]+:[^\s@'"]+@/i,
    confidence: 'high',
  },
];

const PLACEHOLDER = /(process\.env|import\.meta\.env|\$\{|<your|xxx+|placeholder|example|changeme|dummy|test|fake|\*{4,})/i;

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}${'*'.repeat(Math.min(12, trimmed.length - 6))}${trimmed.slice(-3)}`;
}

export function scanTextForSecrets(text: string, filePath = ''): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length > 2000) continue;
    for (const rule of RULES) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const value = match[0];
      if (PLACEHOLDER.test(value)) continue;
      findings.push({
        path: filePath,
        line: index + 1,
        kind: rule.kind,
        masked: maskSecret(value),
        confidence: rule.confidence,
      });
    }
  }
  return findings;
}

export async function scanWorkspaceForSecrets(root = workspaceRoot()): Promise<SecretFinding[]> {
  const files = await walkFiles('.', { root, maxFiles: 4_000 });
  const findings: SecretFinding[] = [];
  for (const relative of files) {
    if (isProbablyBinary(relative)) continue;
    if (relative.endsWith('.lock') || relative.endsWith('package-lock.json')) continue;
    let content: string;
    try {
      const stats = await fs.stat(path.join(root, relative));
      if (stats.size > 1_000_000) continue;
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanTextForSecrets(content, relative));
    if (findings.length > 500) break;
  }
  return findings;
}
