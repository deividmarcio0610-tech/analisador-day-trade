import type { DiffFile, ProcessResult } from '@/core/types';
import { workspaceRoot } from '@/core/paths';
import { runCommand } from './process-runner';
import { logger } from '@/core/logging/logger';

/**
 * GIT TOOL
 *
 * Thin, honest wrapper over the git CLI: every value returned here came from a
 * real git invocation. Nothing is inferred when git is unavailable — callers
 * receive `available: false` instead.
 */

async function git(
  argsLine: string,
  options: { cwd?: string; confirmed?: boolean; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return runCommand({
    commandLine: `git ${argsLine}`,
    cwd: options.cwd,
    confirmed: options.confirmed ?? true,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
}

export async function isGitRepository(cwd?: string): Promise<boolean> {
  const result = await git('rev-parse --is-inside-work-tree', { cwd });
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

export interface GitFileStatus {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  available: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  clean: boolean;
  detail?: string;
}

export async function gitStatus(cwd?: string): Promise<GitStatus> {
  if (!(await isGitRepository(cwd))) {
    return {
      available: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      clean: true,
      detail: 'Not a git repository',
    };
  }

  const result = await git('status --porcelain=v2 --branch', { cwd });
  const files: GitFileStatus[] = [];
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice('# branch.upstream '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] ?? '..';
      const filePath = line.startsWith('2 ')
        ? (parts.slice(9).join(' ').split('\t')[0] ?? '')
        : parts.slice(8).join(' ');
      files.push({
        path: filePath,
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        staged: (xy[0] ?? '.') !== '.',
        untracked: false,
      });
    } else if (line.startsWith('? ')) {
      files.push({
        path: line.slice(2),
        index: '?',
        worktree: '?',
        staged: false,
        untracked: true,
      });
    }
  }

  return {
    available: true,
    branch,
    upstream,
    ahead,
    behind,
    files,
    clean: files.length === 0,
  };
}

export async function gitDiff(
  options: { staged?: boolean; path?: string; cwd?: string } = {},
): Promise<{ available: boolean; raw: string; files: DiffFile[] }> {
  if (!(await isGitRepository(options.cwd))) return { available: false, raw: '', files: [] };

  const scope = options.staged ? '--cached' : '';
  const pathArg = options.path ? `-- "${options.path.replace(/"/g, '\\"')}"` : '';
  const numstat = await git(`diff ${scope} --numstat ${pathArg}`.trim(), { cwd: options.cwd });
  const raw = await git(`diff ${scope} ${pathArg}`.trim(), { cwd: options.cwd });

  const files: DiffFile[] = [];
  for (const line of numstat.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [additions, deletions, filePath] = line.split('\t');
    if (!filePath) continue;
    files.push({
      path: filePath,
      status: 'modified',
      additions: additions === '-' ? 0 : Number(additions ?? 0),
      deletions: deletions === '-' ? 0 : Number(deletions ?? 0),
      patch: extractPatchFor(raw.stdout, filePath),
    });
  }

  // Untracked files are invisible to `git diff`; surface them explicitly.
  if (!options.staged) {
    const untracked = await git('ls-files --others --exclude-standard', { cwd: options.cwd });
    for (const filePath of untracked.stdout.split('\n').map((value) => value.trim())) {
      if (!filePath) continue;
      if (options.path && filePath !== options.path) continue;
      files.push({ path: filePath, status: 'untracked', additions: 0, deletions: 0, patch: '' });
    }
  }

  return { available: true, raw: raw.stdout, files };
}

function extractPatchFor(raw: string, filePath: string): string {
  const marker = `diff --git a/${filePath} b/${filePath}`;
  const start = raw.indexOf(marker);
  if (start < 0) return '';
  const next = raw.indexOf('\ndiff --git ', start + marker.length);
  return next < 0 ? raw.slice(start) : raw.slice(start, next + 1);
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export async function gitLog(limit = 30, cwd?: string): Promise<GitCommit[]> {
  if (!(await isGitRepository(cwd))) return [];
  const separator = '\u001f';
  const result = await git(
    `log -n ${Math.min(Math.max(limit, 1), 500)} --pretty=format:%H${separator}%h${separator}%an${separator}%aI${separator}%s`,
    { cwd },
  );
  return result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash = '', shortHash = '', author = '', date = '', subject = ''] = line.split(separator);
      return { hash, shortHash, author, date, subject };
    });
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

export async function gitBranches(cwd?: string): Promise<GitBranch[]> {
  if (!(await isGitRepository(cwd))) return [];
  const result = await git('branch -a --format=%(refname:short)%09%(HEAD)', { cwd });
  return result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name = '', head = ''] = line.split('\t');
      return {
        name,
        current: head.trim() === '*',
        remote: name.startsWith('remotes/') || name.startsWith('origin/'),
      };
    });
}

export interface Checkpoint {
  tag: string;
  sha: string;
  createdAt: string;
}

const CHECKPOINT_PREFIX = 'vision/checkpoint/';

/**
 * Create a non-destructive checkpoint of the current working tree.
 *
 * `git stash create` builds a dangling commit from the working tree without
 * touching it; tagging that commit makes it recoverable. When the tree is clean
 * the checkpoint points at HEAD.
 */
export async function createCheckpoint(label: string, cwd?: string): Promise<Checkpoint | null> {
  if (!(await isGitRepository(cwd))) return null;
  const stash = await git('stash create', { cwd });
  let sha = stash.stdout.trim();
  if (!sha) {
    const head = await git('rev-parse HEAD', { cwd });
    if (head.exitCode !== 0) return null;
    sha = head.stdout.trim();
  }
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'checkpoint';
  const tag = `${CHECKPOINT_PREFIX}${Date.now()}-${safeLabel}`;
  const tagged = await git(`tag ${tag} ${sha}`, { cwd });
  if (tagged.exitCode !== 0) {
    logger.warn('git', `checkpoint tag failed: ${tagged.stderr.trim()}`);
    return null;
  }
  logger.success('git', `checkpoint created: ${tag}`, { data: { sha } });
  return { tag, sha, createdAt: new Date().toISOString() };
}

export async function listCheckpoints(cwd?: string): Promise<Checkpoint[]> {
  if (!(await isGitRepository(cwd))) return [];
  const result = await git(`tag --list "${CHECKPOINT_PREFIX}*" --format=%(refname:short)%09%(objectname)`, {
    cwd,
  });
  return result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [tag = '', sha = ''] = line.split('\t');
      const stamp = Number(tag.slice(CHECKPOINT_PREFIX.length).split('-')[0]);
      return {
        tag,
        sha,
        createdAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : '',
      };
    })
    .reverse();
}

/** Restore files from a checkpoint. Destructive: requires explicit confirmation. */
export async function restoreCheckpoint(
  tag: string,
  options: { confirmed: boolean; cwd?: string },
): Promise<ProcessResult> {
  if (!options.confirmed) {
    throw new Error('restoreCheckpoint requires explicit confirmation: it overwrites working files');
  }
  if (!tag.startsWith(CHECKPOINT_PREFIX)) {
    throw new Error(`Refusing to restore from a non-checkpoint ref: ${tag}`);
  }
  return git(`checkout ${tag} -- .`, { cwd: options.cwd, confirmed: true });
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string | null;
}

export async function listWorktrees(cwd?: string): Promise<Worktree[]> {
  if (!(await isGitRepository(cwd))) return [];
  const result = await git('worktree list --porcelain', { cwd });
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? null, head: current.head ?? null });
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length);
  }
  if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? null, head: current.head ?? null });
  return worktrees;
}

/** Isolated worktree for a concurrent agent. Path stays outside the main tree. */
export async function createWorktree(
  name: string,
  options: { cwd?: string; baseRef?: string } = {},
): Promise<{ ok: boolean; path: string; detail: string }> {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48);
  const target = `${workspaceRoot()}/.vision/worktrees/${safeName}`;
  const branch = `vision/wt/${safeName}`;
  const result = await git(
    `worktree add -b ${branch} "${target}" ${options.baseRef ?? 'HEAD'}`,
    { cwd: options.cwd, confirmed: true },
  );
  return {
    ok: result.exitCode === 0,
    path: target,
    detail: result.exitCode === 0 ? `worktree ready on ${branch}` : result.stderr.trim(),
  };
}

export async function removeWorktree(
  worktreePath: string,
  options: { confirmed: boolean; cwd?: string },
): Promise<ProcessResult> {
  if (!options.confirmed) throw new Error('removeWorktree requires explicit confirmation');
  return git(`worktree remove --force "${worktreePath}"`, { cwd: options.cwd, confirmed: true });
}

export async function gitStashList(cwd?: string): Promise<string[]> {
  if (!(await isGitRepository(cwd))) return [];
  const result = await git('stash list', { cwd });
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
}
