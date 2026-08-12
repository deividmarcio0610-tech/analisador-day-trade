import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';
import { scanWorkspaceForSecrets, type SecretFinding } from './secret-guard';

/**
 * SECURITY REVIEW (defensive, static)
 *
 * Reviews the user's own codebase for common self-inflicted problems. These are
 * heuristics over source text — they surface places to look, never a claim that
 * the application is or is not secure.
 */

export interface SecurityFinding {
  severity: 'high' | 'medium' | 'low';
  category:
    | 'injection'
    | 'xss'
    | 'secrets'
    | 'validation'
    | 'transport'
    | 'authz'
    | 'configuration'
    | 'dependencies';
  path: string;
  line: number;
  summary: string;
  detail: string;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  secrets: SecretFinding[];
  scannedFiles: number;
}

interface Rule {
  category: SecurityFinding['category'];
  severity: SecurityFinding['severity'];
  pattern: RegExp;
  summary: string;
  detail: string;
  /** Only apply to files matching this predicate. */
  appliesTo?: (file: string) => boolean;
}

const isClientFile = (file: string): boolean =>
  file.includes('/components/') || file.endsWith('.tsx') || file.includes('/app/');

const RULES: Rule[] = [
  {
    category: 'xss',
    severity: 'high',
    pattern: /dangerouslySetInnerHTML/,
    summary: 'Raw HTML injected into the DOM',
    detail: 'dangerouslySetInnerHTML bypasses React escaping. Sanitise the value or render it as text.',
  },
  {
    category: 'injection',
    severity: 'high',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    summary: 'Dynamic code execution',
    detail: 'eval/new Function executes arbitrary strings. Replace with an explicit dispatch table.',
  },
  {
    category: 'injection',
    severity: 'high',
    pattern: /(?:query|execute|exec)\s*\(\s*[`'"][^`'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^`'"]*\$\{/i,
    summary: 'SQL built by string interpolation',
    detail: 'Interpolated SQL is injectable. Use parameter placeholders instead.',
  },
  {
    category: 'injection',
    severity: 'high',
    pattern: /\bexec\s*\(\s*[`'"][^`'"]*\$\{/,
    summary: 'Shell command built by string interpolation',
    detail: 'User controlled values inside a shell command allow command injection. Pass arguments as an array.',
  },
  {
    category: 'secrets',
    severity: 'high',
    pattern: /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)/,
    summary: 'Secret-looking value exposed to the browser',
    detail: 'NEXT_PUBLIC_ variables are inlined into the client bundle. Move it server side.',
  },
  {
    category: 'transport',
    severity: 'medium',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    summary: 'TLS verification disabled',
    detail: 'Disabling certificate verification removes protection against interception.',
  },
  {
    category: 'configuration',
    severity: 'medium',
    pattern: /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
    summary: 'CORS open to every origin',
    detail: 'A wildcard origin lets any site call this endpoint with the user browser context.',
  },
  {
    category: 'authz',
    severity: 'medium',
    pattern: /\.(?:role|isAdmin|admin)\s*===?\s*['"`]?(?:admin|true)['"`]?/,
    summary: 'Authorization decided from a client-shaped value',
    detail: 'Confirm this check runs server side against trusted session data.',
    appliesTo: isClientFile,
  },
];

function isTestFile(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|fixtures?)\//.test(`/${filePath}`) || /\.(test|spec)\.[tj]sx?$/.test(filePath)
  );
}

/** Comments, rule declarations and descriptive fields carry prose, not behaviour. */
export function isProseLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('#') ||
    /\bpattern\s*:\s*\//.test(trimmed) ||
    /new RegExp\(/.test(trimmed) ||
    /^(detail|summary|reason|description|message|label|title|placeholder)\s*:/.test(trimmed)
  );
}

export async function runSecurityReview(root = workspaceRoot()): Promise<SecurityReport> {
  const files = await walkFiles('.', {
    root,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    maxFiles: 4_000,
  });

  const findings: SecurityFinding[] = [];
  let scanned = 0;

  for (const relative of files) {
    let content: string;
    try {
      const stats = await fs.stat(path.join(root, relative));
      if (stats.size > 1_000_000) continue;
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const lines = content.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      // These rules match code. A line that only describes code — a comment, a
      // detection pattern, or a documentation string — is not a finding.
      if (isProseLine(line)) continue;
      for (const rule of RULES) {
        if (rule.appliesTo && !rule.appliesTo(relative)) continue;
        if (!rule.pattern.test(line)) continue;
        findings.push({
          // Matches inside test files are usually fixtures, so they are reported
          // at low severity rather than dropped — a test can still ship a real problem.
          severity: isTestFile(relative) ? 'low' : rule.severity,
          category: rule.category,
          path: relative,
          line: index + 1,
          summary: rule.summary,
          detail: rule.detail,
        });
      }
    }

    // API routes that read a body without validating it.
    if (/(^|\/)route\.tsx?$/.test(relative) && /await\s+\w+\.json\(\)/.test(content)) {
      const validated = /safeParse|\.parse\(|zod|valibot|yup|joi|typia/.test(content);
      if (!validated) {
        const line = lines.findIndex((value) => /await\s+\w+\.json\(\)/.test(value)) + 1;
        findings.push({
          severity: 'medium',
          category: 'validation',
          path: relative,
          line: Math.max(1, line),
          summary: 'Request body used without schema validation',
          detail: 'Parse the body with a schema before using it; untrusted shapes reach the handler otherwise.',
        });
      }
    }
  }

  const secrets = await scanWorkspaceForSecrets(root);
  for (const secret of secrets) {
    findings.push({
      severity: secret.confidence === 'high' ? 'high' : secret.confidence === 'medium' ? 'medium' : 'low',
      category: 'secrets',
      path: secret.path,
      line: secret.line,
      summary: `Possible ${secret.kind} in source`,
      detail: `Matched value (masked): ${secret.masked}. Move it to an environment variable and rotate it.`,
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, secrets, scannedFiles: scanned };
}
