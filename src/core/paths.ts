import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Filesystem boundaries for the Vision agent.
 *
 * Every path that reaches a tool is resolved against a workspace root and
 * rejected if it escapes it. This is the single choke point for that rule.
 */

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'bin',
  'obj',
  '.turbo',
  '.venv',
  '__pycache__',
  '.vision',
]);

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

export function ignoredDirectories(): string[] {
  return [...IGNORED_DIRECTORIES];
}

/** Root of the repository/workspace the agent is allowed to touch. */
export function workspaceRoot(): string {
  const configured = process.env.VISION_WORKSPACE_ROOT;
  const root = configured && configured.trim().length > 0 ? configured : process.cwd();
  return path.resolve(root);
}

/** Directory holding Vision runtime state (SQLite database, checkpoints, logs). */
export function dataDir(): string {
  const configured = process.env.VISION_DATA_DIR;
  const dir =
    configured && configured.trim().length > 0
      ? path.resolve(configured)
      : path.join(workspaceRoot(), '.vision');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function databaseFile(): string {
  const configured = process.env.VISION_DB_FILE;
  if (configured && configured.trim().length > 0) return path.resolve(configured);
  return path.join(dataDir(), 'vision.db');
}

export class PathEscapeError extends Error {
  constructor(requested: string, root: string) {
    super(`Path "${requested}" resolves outside the workspace root "${root}"`);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve a user supplied (relative or absolute) path inside `root`.
 * Throws PathEscapeError when the result would leave the root.
 */
export function resolveInside(root: string, requested: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, requested);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathEscapeError(requested, base);
  }
  return target;
}

/** Path relative to the root, using POSIX separators (stable across platforms). */
export function toRelative(root: string, absolute: string): string {
  return path.relative(path.resolve(root), absolute).split(path.sep).join('/');
}

export function homeDir(): string {
  return os.homedir();
}
