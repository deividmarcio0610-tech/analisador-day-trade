import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, asNumber, asText } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import { workspaceRoot } from '@/core/paths';
import { isIgnoredDirectory } from '@/core/paths';

/**
 * PERFORMANCE LAB
 *
 * Host metrics come from the OS. Build/test durations come from runs that this
 * platform actually executed. Bundle size is measured on disk. Nothing here is
 * estimated.
 */

export interface HostMetrics {
  platform: string;
  cpuModel: string;
  cpuCount: number;
  loadAverage: number[];
  totalMemoryMb: number;
  freeMemoryMb: number;
  processRssMb: number;
  uptimeSeconds: number;
}

export interface DurationMetric {
  label: string;
  runs: number;
  lastMs: number | null;
  averageMs: number | null;
  bestMs: number | null;
  worstMs: number | null;
}

export interface BundleMetric {
  path: string;
  sizeBytes: number;
  files: number;
}

export interface PerformanceReport {
  host: HostMetrics;
  durations: DurationMetric[];
  bundles: BundleMetric[];
  collectedAt: string;
}

export function hostMetrics(): HostMetrics {
  const cpus = os.cpus();
  return {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    loadAverage: os.loadavg(),
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
    processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeSeconds: Math.round(os.uptime()),
  };
}

/** Aggregated durations of the commands this platform executed. */
export function durationMetrics(): DurationMetric[] {
  const rows = getDb()
    .prepare(
      `SELECT runner AS label,
              COUNT(*) AS runs,
              AVG(duration_ms) AS average,
              MIN(duration_ms) AS best,
              MAX(duration_ms) AS worst
       FROM test_runs
       WHERE duration_ms IS NOT NULL
       GROUP BY runner`,
    )
    .all();

  return rows.map((row) => {
    const label = asText(row.label);
    const last = getDb()
      .prepare('SELECT duration_ms FROM test_runs WHERE runner = ? ORDER BY created_at DESC LIMIT 1')
      .get(label);
    return {
      label,
      runs: asNumber(row.runs),
      lastMs: last ? asNumber(last.duration_ms) : null,
      averageMs: Math.round(asNumber(row.average)),
      bestMs: asNumber(row.best),
      worstMs: asNumber(row.worst),
    };
  });
}

async function directorySize(dir: string): Promise<{ sizeBytes: number; files: number }> {
  let sizeBytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length > 0) {
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
        stack.push(absolute);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.stat(absolute);
          sizeBytes += stats.size;
          files += 1;
        } catch {
          continue;
        }
      }
    }
  }
  return { sizeBytes, files };
}

export async function bundleMetrics(root = workspaceRoot()): Promise<BundleMetric[]> {
  const candidates = ['.next/static', 'dist', 'build', 'out'];
  const metrics: BundleMetric[] = [];
  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    try {
      const stats = await fs.stat(absolute);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }
    const measured = await directorySize(absolute);
    metrics.push({ path: candidate, ...measured });
  }
  return metrics;
}

export async function performanceReport(): Promise<PerformanceReport> {
  return {
    host: hostMetrics(),
    durations: durationMetrics(),
    bundles: await bundleMetrics(),
    collectedAt: nowIso(),
  };
}

export function recordBenchmark(input: {
  projectId: string;
  label: string;
  metric: string;
  value: number;
  unit: string;
  context?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO benchmarks (id, project_id, label, metric, value, unit, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('bench'),
      input.projectId,
      input.label,
      input.metric,
      input.value,
      input.unit,
      input.context ?? null,
      nowIso(),
    );
}

export interface BenchmarkRecord {
  id: string;
  label: string;
  metric: string;
  value: number;
  unit: string;
  context: string | null;
  createdAt: string;
}

export function listBenchmarks(projectId: string, limit = 100): BenchmarkRecord[] {
  return getDb()
    .prepare('SELECT * FROM benchmarks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit)
    .map((row) => ({
      id: asText(row.id),
      label: asText(row.label),
      metric: asText(row.metric),
      value: asNumber(row.value),
      unit: asText(row.unit),
      context: row.context === null || row.context === undefined ? null : asText(row.context),
      createdAt: asText(row.created_at),
    }));
}

/** Line/file counts for the workspace, used by the Dashboard. */
export async function workspaceSize(root = workspaceRoot()): Promise<{ files: number; sizeBytes: number }> {
  let files = 0;
  let sizeBytes = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        files += 1;
        try {
          sizeBytes += (await fs.stat(path.join(current, entry.name))).size;
        } catch {
          continue;
        }
      }
    }
  }
  return { files, sizeBytes };
}
