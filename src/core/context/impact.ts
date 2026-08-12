import path from 'node:path';
import { buildCodeGraph, dependentsOf, transitiveDependents, type CodeGraph } from './code-graph';
import { walkFiles } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';

/**
 * IMPACT ANALYZER
 *
 * Answers "what does this patch touch?" before it is applied: direct callers,
 * transitive blast radius, affected API routes, database modules and tests.
 */

export interface ImpactReport {
  changedFiles: string[];
  directDependents: string[];
  transitiveDependents: string[];
  affectedApiRoutes: string[];
  affectedDatabaseModules: string[];
  relatedTests: string[];
  unknownFiles: string[];
}

export async function analyzeImpact(
  changedFiles: string[],
  options: { root?: string; depth?: number } = {},
): Promise<ImpactReport> {
  const root = options.root ?? workspaceRoot();
  const graph: CodeGraph = await buildCodeGraph({ root });
  const known = new Set(graph.nodes.map((node) => node.id));

  const direct = new Set<string>();
  const transitive = new Set<string>();
  const unknown: string[] = [];

  for (const file of changedFiles) {
    if (!known.has(file)) {
      unknown.push(file);
      continue;
    }
    for (const dependent of dependentsOf(graph, file)) direct.add(dependent);
    for (const dependent of transitiveDependents(graph, file, options.depth ?? 3)) {
      transitive.add(dependent);
    }
  }
  for (const file of changedFiles) {
    direct.delete(file);
    transitive.delete(file);
  }

  const universe = new Set([...changedFiles, ...direct, ...transitive]);
  const affectedApiRoutes = [...universe].filter(
    (file) => file.includes('/api/') || file.endsWith('route.ts') || file.includes('/routes/'),
  );
  const affectedDatabaseModules = [...universe].filter(
    (file) => /\/(db|database|migrations?|schema|repo|repositories)\//.test(`/${file}`) || /repo\.ts$/.test(file),
  );

  const allFiles = await walkFiles('.', { root });
  const relatedTests = new Set<string>();
  for (const file of universe) {
    if (/\.(test|spec)\.[tj]sx?$/.test(file)) {
      relatedTests.add(file);
      continue;
    }
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    for (const candidate of allFiles) {
      if (/\.(test|spec)\.[tj]sx?$/.test(candidate) && candidate.includes(stem)) {
        relatedTests.add(candidate);
      }
    }
  }

  return {
    changedFiles,
    directDependents: [...direct].sort(),
    transitiveDependents: [...transitive].sort(),
    affectedApiRoutes: affectedApiRoutes.sort(),
    affectedDatabaseModules: affectedDatabaseModules.sort(),
    relatedTests: [...relatedTests].sort(),
    unknownFiles: unknown.sort(),
  };
}

export function renderImpact(report: ImpactReport): string {
  const lines = [
    `changed: ${report.changedFiles.length} file(s)`,
    `direct dependents: ${report.directDependents.length}`,
    `transitive dependents: ${report.transitiveDependents.length}`,
    `api routes affected: ${report.affectedApiRoutes.length}`,
    `database modules affected: ${report.affectedDatabaseModules.length}`,
    `related tests: ${report.relatedTests.length}`,
  ];
  if (report.unknownFiles.length > 0) {
    lines.push(`new/unindexed files: ${report.unknownFiles.join(', ')}`);
  }
  return lines.join('\n');
}
