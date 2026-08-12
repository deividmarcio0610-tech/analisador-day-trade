'use client';

import { useState } from 'react';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, Spinner, VerdictBadge } from '@/components/ui/primitives';
import { api, formatDuration, formatTime } from '@/lib/api';
import type { EvidenceItem, Verdict } from '@/core/types';

interface ChecksResponse {
  commands: Record<string, string | null>;
  runners: string[];
  history: Array<{
    id: string;
    runner: string;
    command: string;
    exitCode: number | null;
    verdict: Verdict;
    passed: number | null;
    failed: number | null;
    total: number | null;
    durationMs: number | null;
    createdAt: string;
  }>;
}

const KINDS = ['lint', 'typecheck', 'test', 'e2e', 'build'] as const;

/** TESTS: run the project's own commands and keep the evidence. */
export default function TestsPage() {
  const { data, error, refresh } = usePoll<ChecksResponse>('/api/checks', 0);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<EvidenceItem[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const run = async (kind: (typeof KINDS)[number]): Promise<void> => {
    setRunning(kind);
    setRunError(null);
    try {
      const evidence = await api.post<EvidenceItem>('/api/checks', { kind });
      setResults((previous) => [evidence, ...previous]);
      void refresh();
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />

      <Panel
        title="Detected commands"
        actions={running ? <Spinner label={running} /> : null}
        className="mb-3"
      >
        <div className="px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="vc-button"
                disabled={running !== null || !data?.commands[kind]}
                onClick={() => void run(kind)}
              >
                Run {kind}
              </button>
            ))}
          </div>
          <table className="w-full text-left text-[12px]">
            <tbody>
              {KINDS.map((kind) => (
                <tr key={kind} className="border-b border-line last:border-0">
                  <td className="w-24 py-1.5 text-ink-dim">{kind}</td>
                  <td className="py-1.5 vc-mono text-ink">
                    {data?.commands[kind] ?? <span className="text-amber">NOT CONFIGURED</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-ink-faint">
            Runners detected: {data?.runners.join(', ') || 'none'}
          </div>
        </div>
      </Panel>

      {runError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          {runError}
        </div>
      )}

      {results.length > 0 && (
        <Panel title="This session" className="mb-3">
          <div className="px-4 py-3">
            {results.map((item, index) => (
              <div key={index} className="mb-3 border-b border-line pb-3 last:mb-0 last:border-0 last:pb-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={item.verdict} />
                  <span className="vc-mono text-[11.5px] text-ink-dim">{item.command}</span>
                  <span className="text-[11px] text-ink-faint">{item.summary}</span>
                </div>
                {item.output && (
                  <pre className="vc-scroll vc-mono max-h-64 whitespace-pre-wrap rounded border border-line bg-void px-3 py-2 text-[11px] text-ink-faint">
                    {item.output}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Recorded runs">
        {(data?.history.length ?? 0) === 0 ? (
          <Empty>No test run has been recorded by this platform yet.</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2">Verdict</th>
                <th className="px-4 py-2">Command</th>
                <th className="px-4 py-2">Passed</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {data?.history.map((run) => (
                <tr key={run.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5">
                    <VerdictBadge verdict={run.verdict} />
                  </td>
                  <td className="px-4 py-1.5 vc-mono text-ink-dim">{run.command}</td>
                  <td className="px-4 py-1.5 text-ink-dim">
                    {run.total === null ? '—' : `${run.passed ?? 0}/${run.total}`}
                  </td>
                  <td className="px-4 py-1.5 text-ink-faint">{formatDuration(run.durationMs)}</td>
                  <td className="px-4 py-1.5 text-ink-faint">{formatTime(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
