'use client';

import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, KeyValue, Panel, Spinner } from '@/components/ui/primitives';
import { formatBytes, formatDuration, formatTime } from '@/lib/api';

interface PerformanceResponse {
  host: {
    platform: string;
    cpuModel: string;
    cpuCount: number;
    loadAverage: number[];
    totalMemoryMb: number;
    freeMemoryMb: number;
    processRssMb: number;
    uptimeSeconds: number;
  };
  durations: Array<{
    label: string;
    runs: number;
    lastMs: number | null;
    averageMs: number | null;
    bestMs: number | null;
    worstMs: number | null;
  }>;
  bundles: Array<{ path: string; sizeBytes: number; files: number }>;
  workspace: { files: number; sizeBytes: number };
  router: Array<{ role: string; provider: string; model: string; runs: number; errors: number; avgDurationMs: number }>;
  collectedAt: string;
}

/** PERFORMANCE LAB: host metrics, measured durations, bundle sizes, router stats. */
export default function PerformancePage() {
  const { data, error, loading, refresh } = usePoll<PerformanceResponse>('/api/performance', 15_000);

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />
      {loading && !data && <div className="p-4"><Spinner label="measuring" /></div>}

      {data && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="Host"
              actions={
                <button type="button" className="vc-button py-1" onClick={() => void refresh()}>
                  Refresh
                </button>
              }
            >
              <KeyValue
                items={[
                  ['Platform', data.host.platform],
                  ['CPU', `${data.host.cpuModel} · ${data.host.cpuCount} core(s)`],
                  ['Load average', data.host.loadAverage.map((value) => value.toFixed(2)).join('  ')],
                  [
                    'Memory',
                    `${data.host.totalMemoryMb - data.host.freeMemoryMb} / ${data.host.totalMemoryMb} MB used`,
                  ],
                  ['Server RSS', `${data.host.processRssMb} MB`],
                  ['Uptime', formatDuration(data.host.uptimeSeconds * 1000)],
                  ['Collected', formatTime(data.collectedAt)],
                ]}
              />
            </Panel>

            <Panel title="Workspace">
              <KeyValue
                items={[
                  ['Files', String(data.workspace.files)],
                  ['Size', formatBytes(data.workspace.sizeBytes)],
                  [
                    'Build output',
                    data.bundles.length === 0
                      ? 'no build output on disk yet'
                      : data.bundles
                          .map((bundle) => `${bundle.path}: ${formatBytes(bundle.sizeBytes)} (${bundle.files} files)`)
                          .join(' · '),
                  ],
                ]}
              />
            </Panel>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Measured run durations">
              {data.durations.length === 0 ? (
                <Empty>No run recorded yet. Durations appear after a check runs.</Empty>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2">Runner</th>
                      <th className="px-4 py-2">Runs</th>
                      <th className="px-4 py-2">Last</th>
                      <th className="px-4 py-2">Average</th>
                      <th className="px-4 py-2">Best</th>
                      <th className="px-4 py-2">Worst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.durations.map((duration) => (
                      <tr key={duration.label} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 text-ink">{duration.label}</td>
                        <td className="px-4 py-1.5 text-ink-dim">{duration.runs}</td>
                        <td className="px-4 py-1.5 text-ink-dim">{formatDuration(duration.lastMs)}</td>
                        <td className="px-4 py-1.5 text-ink-dim">{formatDuration(duration.averageMs)}</td>
                        <td className="px-4 py-1.5 text-success">{formatDuration(duration.bestMs)}</td>
                        <td className="px-4 py-1.5 text-amber">{formatDuration(duration.worstMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Model router">
              {data.router.length === 0 ? (
                <Empty>No agent run recorded yet.</Empty>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2">Runs</th>
                      <th className="px-4 py-2">Errors</th>
                      <th className="px-4 py-2">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.router.map((stat, index) => (
                      <tr key={index} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 capitalize text-ink">{stat.role}</td>
                        <td className="px-4 py-1.5 vc-mono text-ink-dim">
                          {stat.provider}/{stat.model}
                        </td>
                        <td className="px-4 py-1.5 text-ink-dim">{stat.runs}</td>
                        <td className={stat.errors > 0 ? 'px-4 py-1.5 text-danger' : 'px-4 py-1.5 text-ink-dim'}>
                          {stat.errors}
                        </td>
                        <td className="px-4 py-1.5 text-ink-dim">{formatDuration(stat.avgDurationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
