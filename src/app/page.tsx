'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, KeyValue, Panel, Spinner, StatusDot, VerdictBadge } from '@/components/ui/primitives';
import { CommandBar } from '@/components/command-bar';
import { api, formatTime } from '@/lib/api';
import type { SystemStatus } from '@/lib/types';
import type { EvidenceItem, Job, Verdict } from '@/core/types';
import { useRouter } from 'next/navigation';

interface HealthResponse {
  health: {
    score: number | null;
    dimensions: Array<{ key: string; label: string; verdict: Verdict; detail: string }>;
    collectedAt: string;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const system = usePoll<SystemStatus>('/api/system', 15_000);
  const health = usePoll<HealthResponse>('/api/quality?scope=health', 60_000);
  const [running, setRunning] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<EvidenceItem | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const runCheck = async (kind: 'lint' | 'typecheck' | 'test' | 'build'): Promise<void> => {
    setRunning(kind);
    setCheckError(null);
    try {
      setLastCheck(await api.post<EvidenceItem>('/api/checks', { kind }));
      void health.refresh();
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(null);
    }
  };

  const data = system.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="vc-scroll min-h-0 flex-1 p-4">
        <ErrorNote error={system.error} />

        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Council" className="lg:col-span-1">
            {!data ? (
              <div className="p-4"><Spinner label="loading" /></div>
            ) : (
              <div className="px-2 py-2">
                {data.agents.map((agent) => (
                  <div key={agent.role} className="flex items-center gap-2 rounded px-2 py-1.5">
                    <StatusDot status={agent.online} />
                    <span className="w-[74px] text-[12px] capitalize text-ink">{agent.role}</span>
                    <span className="vc-mono truncate text-[11.5px] text-ink-dim">{agent.model}</span>
                    <span className="ml-auto text-[10.5px] text-ink-faint">{agent.providerId}</span>
                  </div>
                ))}
                <div className="mt-2 border-t border-line px-2 pt-2 text-[11px] text-ink-faint">
                  Mode {data.orchestrator.defaultMode} · max {data.orchestrator.maxRounds} round(s) ·{' '}
                  {data.orchestrator.autoApplyPatches ? 'auto-apply on' : 'patches need approval'}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Project health" className="lg:col-span-2">
            {!health.data ? (
              <div className="p-4"><Spinner label="collecting signals" /></div>
            ) : (
              <div className="px-4 py-3">
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="text-[30px] font-semibold tabular-nums">
                    {health.data.health.score === null ? '—' : health.data.health.score}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    measured signals only · {formatTime(health.data.health.collectedAt)}
                  </span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {health.data.health.dimensions.map((dimension) => (
                    <div key={dimension.key} className="flex items-start gap-2 rounded-md border border-line bg-surface-raised px-3 py-2">
                      <VerdictBadge verdict={dimension.verdict} />
                      <div className="min-w-0">
                        <div className="text-[12px] text-ink">{dimension.label}</div>
                        <div className="truncate text-[11px] text-ink-faint" title={dimension.detail}>
                          {dimension.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Panel
            title="Verification"
            actions={running && <Spinner label={running} />}
            className="lg:col-span-1"
          >
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {(['lint', 'typecheck', 'test', 'build'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="vc-button"
                  disabled={running !== null || !data?.stack.commands[kind]}
                  title={data?.stack.commands[kind] ?? 'no command detected for this project'}
                  onClick={() => void runCheck(kind)}
                >
                  {kind}
                </button>
              ))}
            </div>
            {checkError && <div className="px-4 pb-3 text-[11.5px] text-danger">{checkError}</div>}
            {lastCheck && (
              <div className="border-t border-line px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <VerdictBadge verdict={lastCheck.verdict} />
                  <span className="vc-mono text-[11.5px] text-ink-dim">{lastCheck.command}</span>
                </div>
                <div className="text-[11.5px] text-ink-faint">{lastCheck.summary}</div>
              </div>
            )}
          </Panel>

          <Panel title="Workspace" className="lg:col-span-1">
            {data && (
              <KeyValue
                items={[
                  ['Root', <span key="root" className="vc-mono">{data.workspaceRoot}</span>],
                  ['Languages', data.stack.languages.join(', ') || 'none detected'],
                  ['Package manager', data.stack.packageManager ?? 'none'],
                  ['Test runners', data.stack.testRunners.join(', ') || 'none detected'],
                  [
                    'Git',
                    data.git.available
                      ? `${data.git.branch ?? 'detached'} · ${data.git.files.length} changed`
                      : 'not a repository',
                  ],
                  ['Processes', String(data.processes.length)],
                ]}
              />
            )}
          </Panel>

          <Panel
            title="Recent jobs"
            actions={
              <Link href="/council" className="text-[11px] text-accent hover:underline">
                open council
              </Link>
            }
            className="lg:col-span-1"
            bodyClassName="vc-scroll max-h-[280px]"
          >
            {(data?.recentJobs.length ?? 0) === 0 ? (
              <Empty>No jobs yet. Use the prompt bar below.</Empty>
            ) : (
              <div className="px-2 py-2">
                {data?.recentJobs.map((job: Job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => router.push(`/council?job=${job.id}`)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <span className="vc-tag">{job.state}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">{job.prompt}</span>
                    <span className="shrink-0 text-[10.5px] text-ink-faint">{formatTime(job.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {data && data.providers.some((provider) => provider.health.status !== 'ONLINE') && (
          <div className="mt-3 rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-[12px] text-amber">
            <strong>Models not fully available.</strong>{' '}
            {data.providers
              .filter((provider) => provider.health.status !== 'ONLINE')
              .map((provider) => `${provider.label}: ${provider.health.status} (${provider.health.detail})`)
              .join(' · ')}
            . Configure endpoints in{' '}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            . Tools, verification and analysis run without models; the council does not.
          </div>
        )}

        {data && (
          <div className="mt-3 text-[11px] text-ink-faint">
            Workspace size and run durations are measured on demand in{' '}
            <Link href="/performance" className="underline">
              Performance
            </Link>
            {data.stack.commands.build ? ` · build command: ${data.stack.commands.build}` : ''}
          </div>
        )}
      </div>

      <CommandBar onJob={(job) => router.push(`/council?job=${job.id}`)} />
    </div>
  );
}
