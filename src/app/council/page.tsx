'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { CommandBar } from '@/components/command-bar';
import { CouncilView } from '@/components/council-view';
import { AiStatusBar } from '@/components/ai-status';
import { useJobStream } from '@/components/hooks/use-job-stream';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, Panel, Spinner } from '@/components/ui/primitives';
import { api, formatTime } from '@/lib/api';
import type { Job } from '@/core/types';

/** AI COUNCIL: pick a job, watch the council work on it live. */

export default function CouncilPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner label="loading council" /></div>}>
      <CouncilScreen />
    </Suspense>
  );
}

function CouncilScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const jobParam = params.get('job');
  const [selected, setSelected] = useState<string | null>(jobParam);
  const jobs = usePoll<{ jobs: Job[] }>('/api/jobs?limit=40', 6_000);
  const stream = useJobStream(selected);

  useEffect(() => {
    setSelected(jobParam);
  }, [jobParam]);

  useEffect(() => {
    if (!selected && jobs.data && jobs.data.jobs.length > 0) {
      setSelected(jobs.data.jobs[0]?.id ?? null);
    }
  }, [jobs.data, selected]);

  const cancel = async (): Promise<void> => {
    if (!selected) return;
    await api.del(`/api/jobs/${selected}`).catch(() => undefined);
    void jobs.refresh();
  };

  // An interrupted job kept its plan, patch and review; resuming reuses them.
  const resume = async (): Promise<void> => {
    if (!selected) return;
    await api.post(`/api/jobs/${selected}`).catch(() => undefined);
    void jobs.refresh();
  };

  const activeJob = jobs.data?.jobs.find((job) => job.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3">
        <AiStatusBar />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-3 p-3">
        <Panel
          title="Jobs"
          actions={
            activeJob?.state === 'INTERRUPTED' ? (
              <button type="button" className="vc-button vc-button-primary" onClick={() => void resume()}>
                Resume
              </button>
            ) : activeJob &&
              !['PASSED', 'FAILED', 'CANCELLED', 'BLOCKED', 'INTERRUPTED'].includes(activeJob.state) ? (
              <button type="button" className="vc-button vc-button-danger" onClick={() => void cancel()}>
                Cancel
              </button>
            ) : null
          }
          bodyClassName="vc-scroll"
        >
          {(jobs.data?.jobs.length ?? 0) === 0 ? (
            <Empty>No jobs yet.</Empty>
          ) : (
            <div className="px-1.5 py-1.5">
              {jobs.data?.jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => {
                    setSelected(job.id);
                    router.replace(`/council?job=${job.id}`);
                  }}
                  className={clsx(
                    'mb-0.5 w-full rounded px-2 py-1.5 text-left hover:bg-surface-hover',
                    selected === job.id && 'bg-surface-hover shadow-[inset_2px_0_0_var(--color-accent)]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="vc-tag">{job.state}</span>
                    <span className="text-[10px] text-ink-faint">{job.mode}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11.5px] text-ink-dim">{job.prompt}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">
                    /{job.command} · {formatTime(job.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="min-h-0">
          {selected ? (
            <CouncilView stream={stream} jobId={selected} onApplied={() => void jobs.refresh()} />
          ) : (
            <Panel title="Council">
              <Empty>Start a task from the prompt bar to convene the council.</Empty>
            </Panel>
          )}
        </div>
      </div>

      <CommandBar
        onJob={(job) => {
          setSelected(job.id);
          router.replace(`/council?job=${job.id}`);
          void jobs.refresh();
        }}
      />
    </div>
  );
}
