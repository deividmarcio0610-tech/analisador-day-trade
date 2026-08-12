import path from 'node:path';
import { readFile, searchContent, walkFiles } from '@/core/tools/filesystem';
import { buildCodeGraph, dependenciesOf, dependentsOf } from './code-graph';
import { gitStatus, gitLog } from '@/core/tools/git';
import { detectStack } from '@/core/tools/stack-detect';
import { workspaceRoot } from '@/core/paths';
import { truncateMiddle } from '@/core/util/text';

/**
 * CONTEXT ENGINE
 *
 * Selects what the model actually needs instead of shipping the repository.
 * Selection order: focus file → its imports → its callers → keyword hits →
 * related tests, cut off by a character budget.
 */

export interface ContextRequest {
  query: string;
  focusFiles?: string[];
  budgetChars?: number;
  includeGit?: boolean;
  root?: string;
}

export interface ContextFile {
  path: string;
  reason: 'focus' | 'import' | 'caller' | 'keyword' | 'test';
  content: string;
  truncated: boolean;
}

export interface ContextBundle {
  files: ContextFile[];
  stack: string;
  gitSummary: string | null;
  keywordHits: Array<{ path: string; line: number; text: string }>;
  totalChars: number;
  budgetChars: number;
  skipped: string[];
}

const DEFAULT_BUDGET = 60_000;
const PER_FILE_LIMIT = 12_000;

export async function buildContext(request: ContextRequest): Promise<ContextBundle> {
  const root = request.root ?? workspaceRoot();
  const budget = request.budgetChars ?? DEFAULT_BUDGET;
  const selected = new Map<string, ContextFile['reason']>();

  for (const file of request.focusFiles ?? []) selected.set(file, 'focus');

  const graph = await buildCodeGraph({ root });
  for (const file of request.focusFiles ?? []) {
    for (const dependency of dependenciesOf(graph, file)) {
      if (!selected.has(dependency)) selected.set(dependency, 'import');
    }
    for (const dependent of dependentsOf(graph, file)) {
      if (!selected.has(dependent)) selected.set(dependent, 'caller');
    }
  }

  const keywords = extractKeywords(request.query);
  const keywordHits: ContextBundle['keywordHits'] = [];
  for (const keyword of keywords.slice(0, 4)) {
    const hits = await searchContent(keyword, { root, maxMatches: 40 });
    for (const hit of hits) {
      keywordHits.push(hit);
      if (!selected.has(hit.path) && selected.size < 40) selected.set(hit.path, 'keyword');
    }
  }

  // Tests covering any selected source file.
  const allFiles = await walkFiles('.', { root });
  for (const file of [...selected.keys()]) {
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    const related = allFiles.filter(
      (candidate) =>
        /\.(test|spec)\.[tj]sx?$/.test(candidate) && candidate.includes(stem) && !selected.has(candidate),
    );
    for (const test of related.slice(0, 2)) selected.set(test, 'test');
  }

  const files: ContextFile[] = [];
  const skipped: string[] = [];
  let used = 0;

  const order: Array<ContextFile['reason']> = ['focus', 'import', 'caller', 'keyword', 'test'];
  const entries = [...selected.entries()].sort(
    (a, b) => order.indexOf(a[1]) - order.indexOf(b[1]),
  );

  // Below this, a file contributes noise rather than context, so it is skipped
  // and reported instead of being sliced into an unreadable fragment.
  const MIN_USEFUL_CHARS = 400;

  for (const [file, reason] of entries) {
    if (budget - used < MIN_USEFUL_CHARS) {
      skipped.push(file);
      continue;
    }
    let read;
    try {
      read = await readFile(file, root);
    } catch {
      skipped.push(file);
      continue;
    }
    if (read.binary) {
      skipped.push(file);
      continue;
    }
    const remaining = budget - used;
    const limit = Math.min(PER_FILE_LIMIT, remaining);
    const content = truncateMiddle(read.content, limit);
    used += content.length;
    files.push({ path: file, reason, content, truncated: content.length < read.content.length });
  }

  const stack = await detectStack(root);
  const stackSummary = [
    `languages: ${stack.languages.join(', ') || 'unknown'}`,
    `package manager: ${stack.packageManager ?? 'none'}`,
    `test runners: ${stack.testRunners.join(', ') || 'none detected'}`,
    `commands: ${Object.entries(stack.commands)
      .map(([key, value]) => `${key}=${value ?? 'NOT CONFIGURED'}`)
      .join(' | ')}`,
  ].join('\n');

  let gitSummary: string | null = null;
  if (request.includeGit !== false) {
    const status = await gitStatus();
    if (status.available) {
      const commits = await gitLog(5);
      gitSummary = [
        `branch: ${status.branch ?? 'unknown'} (ahead ${status.ahead}, behind ${status.behind})`,
        `changed files: ${status.files.length}`,
        ...status.files.slice(0, 20).map((file) => `  ${file.index}${file.worktree} ${file.path}`),
        'recent commits:',
        ...commits.map((commit) => `  ${commit.shortHash} ${commit.subject}`),
      ].join('\n');
    }
  }

  return {
    files,
    stack: stackSummary,
    gitSummary,
    keywordHits: keywordHits.slice(0, 60),
    totalChars: used,
    budgetChars: budget,
    skipped,
  };
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'what', 'why', 'how',
  'fix', 'bug', 'error', 'please', 'should', 'would', 'could', 'into', 'about',
  'para', 'como', 'porque', 'quando', 'erro', 'corrigir', 'fazer', 'está', 'esta',
]);

export function extractKeywords(query: string): string[] {
  const identifiers = query.match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) ?? [];
  const unique = new Map<string, number>();
  for (const raw of identifiers) {
    const token = raw.trim();
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    // Identifiers with camelCase/underscores are far more selective than words.
    const weight = /[A-Z_]/.test(token.slice(1)) ? 3 : 1;
    unique.set(token, (unique.get(token) ?? 0) + weight);
  }
  return [...unique.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 8);
}

/** Render a bundle for a prompt. */
export function renderContext(bundle: ContextBundle): string {
  const parts: string[] = [];
  parts.push(`# PROJECT STACK\n${bundle.stack}`);
  if (bundle.gitSummary) parts.push(`# GIT\n${bundle.gitSummary}`);
  if (bundle.files.length > 0) {
    parts.push('# FILES');
    for (const file of bundle.files) {
      parts.push(`## ${file.path} (selected as: ${file.reason})\n\`\`\`\n${file.content}\n\`\`\``);
    }
  }
  if (bundle.keywordHits.length > 0) {
    parts.push(
      `# KEYWORD MATCHES\n${bundle.keywordHits
        .slice(0, 30)
        .map((hit) => `${hit.path}:${hit.line}: ${hit.text.trim()}`)
        .join('\n')}`,
    );
  }
  if (bundle.skipped.length > 0) {
    parts.push(`# OMITTED FOR BUDGET (${bundle.skipped.length})\n${bundle.skipped.slice(0, 30).join('\n')}`);
  }
  return parts.join('\n\n');
}
