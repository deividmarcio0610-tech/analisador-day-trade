import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileNode } from '@/core/types';
import { isIgnoredDirectory, resolveInside, toRelative, workspaceRoot } from '@/core/paths';
import { logger } from '@/core/logging/logger';

/**
 * FILESYSTEM TOOL
 *
 * Every path is resolved inside the workspace root. Heavy directories
 * (node_modules, .git, dist, build, .next, coverage, bin, obj) are skipped by
 * listings and searches.
 */

const MAX_READ_BYTES = 2_000_000;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wasm', '.so', '.dll', '.exe',
  '.db', '.sqlite', '.class', '.jar', '.bin',
]);

export function isProbablyBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function listDirectory(relativePath = '.', root = workspaceRoot()): Promise<FileNode[]> {
  const target = resolveInside(root, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && isIgnoredDirectory(entry.name)) continue;
    const absolute = path.join(target, entry.name);
    const node: FileNode = {
      name: entry.name,
      path: toRelative(root, absolute),
      type: entry.isDirectory() ? 'directory' : 'file',
    };
    if (entry.isFile()) {
      try {
        const stats = await fs.stat(absolute);
        node.sizeBytes = stats.size;
        node.modifiedAt = stats.mtime.toISOString();
      } catch {
        // Race with a concurrent delete: report the entry without stats.
      }
    }
    nodes.push(node);
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export interface ReadResult {
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  binary: boolean;
}

export async function readFile(relativePath: string, root = workspaceRoot()): Promise<ReadResult> {
  const target = resolveInside(root, relativePath);
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error(`Not a file: ${relativePath}`);

  if (isProbablyBinary(target)) {
    return {
      path: toRelative(root, target),
      content: '',
      sizeBytes: stats.size,
      truncated: false,
      binary: true,
    };
  }

  const buffer = await fs.readFile(target);
  const truncated = buffer.byteLength > MAX_READ_BYTES;
  const content = buffer.subarray(0, MAX_READ_BYTES).toString('utf8');
  return {
    path: toRelative(root, target),
    content,
    sizeBytes: stats.size,
    truncated,
    binary: false,
  };
}

export async function writeFile(
  relativePath: string,
  content: string,
  root = workspaceRoot(),
): Promise<{ path: string; bytes: number }> {
  const target = resolveInside(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  logger.info('filesystem', `wrote ${toRelative(root, target)}`, {
    data: { bytes: Buffer.byteLength(content, 'utf8') },
  });
  return { path: toRelative(root, target), bytes: Buffer.byteLength(content, 'utf8') };
}

export async function deleteFile(relativePath: string, root = workspaceRoot()): Promise<void> {
  const target = resolveInside(root, relativePath);
  await fs.rm(target, { force: true });
  logger.warn('filesystem', `deleted ${toRelative(root, target)}`);
}

export async function pathExists(relativePath: string, root = workspaceRoot()): Promise<boolean> {
  try {
    await fs.access(resolveInside(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

export interface WalkOptions {
  maxFiles?: number;
  extensions?: string[];
  root?: string;
}

/** Depth-first walk returning workspace-relative file paths. */
export async function walkFiles(
  relativeStart = '.',
  options: WalkOptions = {},
): Promise<string[]> {
  const root = options.root ?? workspaceRoot();
  const maxFiles = options.maxFiles ?? 20_000;
  const extensions = options.extensions?.map((ext) => ext.toLowerCase());
  const out: string[] = [];
  const stack: string[] = [resolveInside(root, relativeStart)];

  while (stack.length > 0 && out.length < maxFiles) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue;
        stack.push(absolute);
      } else if (entry.isFile()) {
        if (extensions && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
        out.push(toRelative(root, absolute));
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out.sort();
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  maxMatches?: number;
  extensions?: string[];
  root?: string;
}

/** Content search over the workspace (ignored directories excluded). */
export async function searchContent(
  query: string,
  options: SearchOptions = {},
): Promise<SearchMatch[]> {
  if (query.trim().length === 0) return [];
  const root = options.root ?? workspaceRoot();
  const maxMatches = options.maxMatches ?? 500;
  const files = await walkFiles('.', { root, extensions: options.extensions });
  const matcher = options.regex
    ? new RegExp(query, options.caseSensitive ? 'g' : 'gi')
    : null;
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const relative of files) {
    if (matches.length >= maxMatches) break;
    if (isProbablyBinary(relative)) continue;
    let content: string;
    try {
      const stats = await fs.stat(path.join(root, relative));
      if (stats.size > MAX_READ_BYTES) continue;
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const hit = matcher ? matcher.test(line) : (options.caseSensitive ? line : line.toLowerCase()).includes(needle);
      if (matcher) matcher.lastIndex = 0;
      if (!hit) continue;
      matches.push({ path: relative, line: index + 1, text: line.slice(0, 400) });
      if (matches.length >= maxMatches) break;
    }
  }
  return matches;
}

export interface ReplaceResult {
  path: string;
  replacements: number;
}

/** Literal find/replace across the workspace. Returns per-file replacement counts. */
export async function replaceInFiles(
  find: string,
  replace: string,
  options: { paths?: string[]; root?: string } = {},
): Promise<ReplaceResult[]> {
  if (find.length === 0) throw new Error('Search string must not be empty');
  const root = options.root ?? workspaceRoot();
  const targets = options.paths ?? (await walkFiles('.', { root }));
  const results: ReplaceResult[] = [];

  for (const relative of targets) {
    if (isProbablyBinary(relative)) continue;
    const absolute = resolveInside(root, relative);
    let content: string;
    try {
      content = await fs.readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(find)) continue;
    const replacements = content.split(find).length - 1;
    await fs.writeFile(absolute, content.split(find).join(replace), 'utf8');
    results.push({ path: relative, replacements });
  }
  logger.info('filesystem', `replace across ${results.length} file(s)`);
  return results;
}
