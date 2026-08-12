'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty } from './ui/primitives';
import { formatTime } from '@/lib/api';
import type { LogLevel } from '@/core/types';

interface LogEntryView {
  id: number;
  level: LogLevel;
  scope: string;
  message: string;
  taskId?: string;
  createdAt: string;
}

const LEVELS: LogLevel[] = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEBUG', 'AGENT', 'PROCESS'];

const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO: 'text-info',
  SUCCESS: 'text-success',
  WARNING: 'text-amber',
  ERROR: 'text-danger',
  DEBUG: 'text-ink-faint',
  AGENT: 'text-violet',
  PROCESS: 'text-accent',
};

/** Structured log stream from the server, filterable by level and text. */
export function LogsPanel({ taskId }: { taskId?: string }) {
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [search, setSearch] = useState('');

  const query = new URLSearchParams();
  if (levels.length > 0) query.set('levels', levels.join(','));
  if (search) query.set('search', search);
  if (taskId) query.set('taskId', taskId);

  const { data } = usePoll<{ logs: LogEntryView[] }>(`/api/logs?${query.toString()}`, 4_000);
  const logs = data?.logs ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() =>
              setLevels((previous) =>
                previous.includes(level) ? previous.filter((value) => value !== level) : [...previous, level],
              )
            }
            className={clsx('vc-tag', levels.includes(level) && 'border-accent/50 text-accent')}
          >
            {level}
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="filter…"
          className="vc-input ml-auto h-[26px] w-40 py-0 text-[11.5px]"
        />
      </div>
      <div className="vc-scroll vc-mono min-h-0 flex-1 px-3 py-2 leading-[1.55]">
        {logs.length === 0 ? (
          <Empty>No log entries match this filter.</Empty>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="flex gap-2 whitespace-pre-wrap break-words">
              <span className="shrink-0 text-ink-faint">{formatTime(entry.createdAt)}</span>
              <span className={clsx('w-[62px] shrink-0', LEVEL_COLOR[entry.level])}>{entry.level}</span>
              <span className="shrink-0 text-ink-faint">{entry.scope}</span>
              <span className="text-ink-dim">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
