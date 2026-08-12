import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, isProbablyBinary } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';
import { buildCodeGraph, findCycles } from '@/core/context/code-graph';

/**
 * TECHNICAL DEBT
 *
 * Static, measurable signals only: markers, oversized files, complexity
 * estimates, circular imports and modules nothing imports. Every item points at
 * a file and a line so it can be verified.
 */

export interface DebtMarker {
  path: string;
  line: number;
  kind: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
  text: string;
}

export interface LargeFile {
  path: string;
  lines: number;
  sizeBytes: number;
}

export interface ComplexFunction {
  path: string;
  line: number;
  name: string;
  branches: number;
}

export interface DebtReport {
  markers: DebtMarker[];
  largeFiles: LargeFile[];
  complexFunctions: ComplexFunction[];
  circularImports: string[][];
  orphanModules: string[];
  scannedFiles: number;
}

const MARKER_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]?(.*)$/;
const BRANCH_PATTERN = /\b(if|for|while|case|catch|\?\?|&&|\|\||\?)\b/g;
const LARGE_FILE_LINES = 500;

export async function analyzeTechnicalDebt(root = workspaceRoot()): Promise<DebtReport> {
  const files = await walkFiles('.', {
    root,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.cs'],
    maxFiles: 4_000,
  });

  const markers: DebtMarker[] = [];
  const largeFiles: LargeFile[] = [];
  const complexFunctions: ComplexFunction[] = [];
  let scanned = 0;

  for (const relative of files) {
    if (isProbablyBinary(relative)) continue;
    let content: string;
    let sizeBytes = 0;
    try {
      const absolute = path.join(root, relative);
      const stats = await fs.stat(absolute);
      sizeBytes = stats.size;
      if (stats.size > 1_500_000) continue;
      content = await fs.readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const lines = content.split('\n');

    if (lines.length > LARGE_FILE_LINES) {
      largeFiles.push({ path: relative, lines: lines.length, sizeBytes });
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const match = MARKER_PATTERN.exec(line);
      if (match && isComment(line)) {
        markers.push({
          path: relative,
          line: index + 1,
          kind: (match[1] ?? 'TODO') as DebtMarker['kind'],
          text: (match[2] ?? '').trim().slice(0, 200),
        });
      }
    }

    complexFunctions.push(...estimateComplexity(relative, content));
  }

  const graph = await buildCodeGraph({ root });
  const circularImports = findCycles(graph, 20);
  const orphanModules = graph.nodes
    .filter(
      (node) =>
        node.importedBy === 0 &&
        node.layer !== 'config' &&
        node.layer !== 'test' &&
        // Declaration files, framework entry points and app routes are reached by
        // tooling rather than by an import, so they are never orphans.
        !node.id.endsWith('.d.ts') &&
        !/\/(page|layout|route|index|middleware|not-found|error|loading)\.[tj]sx?$/.test(`/${node.id}`) &&
        !node.id.startsWith('src/app/'),
    )
    .map((node) => node.id);

  return {
    markers: markers.sort((a, b) => a.path.localeCompare(b.path)),
    largeFiles: largeFiles.sort((a, b) => b.lines - a.lines).slice(0, 50),
    complexFunctions: complexFunctions.sort((a, b) => b.branches - a.branches).slice(0, 50),
    circularImports,
    orphanModules,
    scannedFiles: scanned,
  };
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('#') ||
    trimmed.includes('// ') ||
    trimmed.includes('# ')
  );
}

/**
 * Branch-count heuristic per function. It is an estimate, not cyclomatic
 * complexity from an AST, and the UI labels it as such.
 */
export function estimateComplexity(filePath: string, content: string): ComplexFunction[] {
  const lines = content.split('\n');
  const results: ComplexFunction[] = [];
  const declaration =
    /(?:function\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(|([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{|def\s+([A-Za-z0-9_]+))/;

  let currentName: string | null = null;
  let currentLine = 0;
  let depth = 0;
  let branches = 0;
  let started = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!currentName) {
      const match = declaration.exec(line);
      if (match) {
        currentName = match[1] ?? match[2] ?? match[3] ?? match[4] ?? 'anonymous';
        currentLine = index + 1;
        depth = 0;
        branches = 0;
        started = false;
      }
    }
    if (!currentName) continue;

    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (opens > 0) started = true;
    depth += opens - closes;
    branches += (line.match(BRANCH_PATTERN) ?? []).length;

    if (started && depth <= 0) {
      if (branches >= 12) {
        results.push({ path: filePath, line: currentLine, name: currentName, branches });
      }
      currentName = null;
    }
  }
  return results;
}
