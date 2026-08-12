'use client';

import { useState, type ReactNode } from 'react';
import { CommandBar } from './command-bar';
import { CouncilView } from './council-view';
import { useJobStream } from './hooks/use-job-stream';
import { Empty, Panel } from './ui/primitives';
import type { Job } from '@/core/types';

/**
 * Shared frame for the mode-specific screens (Architect, Debug, Research, Lab):
 * an optional header panel, the council view for the running job, and a prompt
 * bar preset to that mode.
 */
export function ModeWorkspace({
  title,
  description,
  mode,
  placeholder,
  header,
  render,
}: {
  title: string;
  description: string;
  mode: 'FAST' | 'ENGINEER' | 'DEEP_ANALYSIS' | 'ARCHITECT' | 'DEBUG' | 'TEAM' | 'EXTREME';
  placeholder: string;
  header?: ReactNode;
  render?: (stream: ReturnType<typeof useJobStream>) => ReactNode;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const stream = useJobStream(jobId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="vc-scroll min-h-0 flex-1 p-3">
        <div className="mb-3 flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">{title}</h1>
          <p className="text-[11.5px] text-ink-faint">{description}</p>
        </div>

        {header}

        {render && jobId && <div className="mb-3">{render(stream)}</div>}

        {jobId ? (
          <div className="h-[calc(100vh-230px)] min-h-[420px]">
            <CouncilView stream={stream} jobId={jobId} />
          </div>
        ) : (
          <Panel title={title}>
            <Empty>Run a task below to start. This screen uses {mode.replace('_', ' ')} mode.</Empty>
          </Panel>
        )}
      </div>

      <CommandBar defaultMode={mode} placeholder={placeholder} onJob={(job: Job) => setJobId(job.id)} />
    </div>
  );
}
