import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';
import { singleton } from '@/core/util/singleton';

/**
 * CODE GRAPH
 *
 * Builds a module graph from real import statements and classifies each module
 * into an architectural layer (component → service → api → database → worker).
 * It is a static approximation and says so: `resolved` marks edges whose target
 * was found on disk, `external` marks package imports.
 */

export type NodeLayer = 'component' | 'service' | 'api' | 'database' | 'worker' | 'test' | 'config' | 'other';

export interface GraphNode {
  id: string;
  label: string;
  layer: NodeLayer;
  sizeBytes: number;
  imports: number;
  importedBy: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  external: boolean;
}

export interface CodeGraph {
  root: string;
  builtAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  externals: Array<{ name: string; count: number }>;
  truncated: boolean;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_FILES = 3_000;

interface CacheEntry {
  key: string;
  graph: CodeGraph;
  builtAtMs: number;
}

function cache(): Map<string, CacheEntry> {
  return singleton('code-graph-cache', () => new Map<string, CacheEntry>());
}

const IMPORT_PATTERN =
  /(?:import\s[^'"]*from\s*['"]([^'"]+)['"])|(?:import\s*['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"]\s*\))|(?:import\(\s*['"]([^'"]+)['"]\s*\))|(?:export\s[^'"]*from\s*['"]([^'"]+)['"])/g;

export function classifyLayer(relativePath: string): NodeLayer {
  const normalized = relativePath.toLowerCase();
  if (/\.(test|spec)\.[tj]sx?$/.test(normalized) || normalized.startsWith('tests/')) return 'test';
  if (normalized.includes('/api/') || normalized.includes('route.ts') || normalized.includes('/routes/')) return 'api';
  if (normalized.includes('/db/') || normalized.includes('repo') || normalized.includes('schema') || normalized.includes('migration')) return 'database';
  if (normalized.includes('worker') || normalized.includes('queue') || normalized.includes('job')) return 'worker';
  if (normalized.includes('/components/') || normalized.endsWith('.tsx')) return 'component';
  if (normalized.includes('config') || normalized.endsWith('.config.ts') || normalized.endsWith('.config.mjs')) return 'config';
  if (normalized.includes('/core/') || normalized.includes('/lib/') || normalized.includes('/services/')) return 'service';
  return 'other';
}

async function resolveImport(fromFile: string, specifier: string, root: string): Promise<string | null> {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;

  const base = specifier.startsWith('@/')
    ? path.join(root, 'src', specifier.slice(2))
    : path.resolve(path.dirname(path.join(root, fromFile)), specifier);

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return path.relative(root, candidate).split(path.sep).join('/');
    } catch {
      continue;
    }
  }
  return null;
}

export async function buildCodeGraph(options: { root?: string; force?: boolean } = {}): Promise<CodeGraph> {
  const root = options.root ?? workspaceRoot();
  const cached = cache().get(root);
  if (cached && !options.force && Date.now() - cached.builtAtMs < 30_000) return cached.graph;

  const files = await walkFiles('.', { root, extensions: SOURCE_EXTENSIONS, maxFiles: MAX_FILES + 1 });
  const truncated = files.length > MAX_FILES;
  const selected = files.slice(0, MAX_FILES);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const externalCounts = new Map<string, number>();

  for (const relative of selected) {
    let stats;
    try {
      stats = await fs.stat(path.join(root, relative));
    } catch {
      continue;
    }
    nodes.set(relative, {
      id: relative,
      label: path.basename(relative),
      layer: classifyLayer(relative),
      sizeBytes: stats.size,
      imports: 0,
      importedBy: 0,
    });
  }

  for (const relative of selected) {
    let content: string;
    try {
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    IMPORT_PATTERN.lastIndex = 0;
    let match = IMPORT_PATTERN.exec(content);
    const seen = new Set<string>();
    while (match !== null) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
      match = IMPORT_PATTERN.exec(content);
      if (!specifier || seen.has(specifier)) continue;
      seen.add(specifier);

      const target = await resolveImport(relative, specifier, root);
      if (target && nodes.has(target)) {
        edges.push({ from: relative, to: target, external: false });
        const fromNode = nodes.get(relative);
        const toNode = nodes.get(target);
        if (fromNode) fromNode.imports += 1;
        if (toNode) toNode.importedBy += 1;
      } else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        const pkg = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : (specifier.split('/')[0] ?? specifier);
        externalCounts.set(pkg, (externalCounts.get(pkg) ?? 0) + 1);
      }
    }
  }

  const graph: CodeGraph = {
    root,
    builtAt: new Date().toISOString(),
    nodes: [...nodes.values()].sort((a, b) => b.importedBy - a.importedBy),
    edges,
    externals: [...externalCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    truncated,
  };

  cache().set(root, { key: root, graph, builtAtMs: Date.now() });
  return graph;
}

export function dependentsOf(graph: CodeGraph, file: string): string[] {
  return graph.edges.filter((edge) => edge.to === file).map((edge) => edge.from);
}

export function dependenciesOf(graph: CodeGraph, file: string): string[] {
  return graph.edges.filter((edge) => edge.from === file).map((edge) => edge.to);
}

/** Transitive dependents up to `depth` levels — the blast radius of a change. */
export function transitiveDependents(graph: CodeGraph, file: string, depth = 2): string[] {
  const seen = new Set<string>();
  let frontier = [file];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const dependent of dependentsOf(graph, current)) {
        if (seen.has(dependent) || dependent === file) continue;
        seen.add(dependent);
        next.push(dependent);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return [...seen];
}

/** Cycles in the import graph (Tarjan-free DFS, capped for large repos). */
export function findCycles(graph: CodeGraph, maxCycles = 25): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const visit = (node: string): void => {
    if (cycles.length >= maxCycles) return;
    visited.add(node);
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (cycles.length >= maxCycles) break;
      if (onStack.has(next)) {
        const index = stack.indexOf(next);
        if (index >= 0) cycles.push([...stack.slice(index), next]);
      } else if (!visited.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    onStack.delete(node);
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) visit(node.id);
    if (cycles.length >= maxCycles) break;
  }
  return cycles;
}
