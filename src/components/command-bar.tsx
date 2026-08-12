'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal, ChevronDown } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { Job } from '@/core/types';
import type { CommandSpec } from '@/core/commands/registry';

/**
 * Prompt bar. `/command` entries are resolved against the server registry;
 * anything else is a free-form request that runs in the selected mode.
 */

const MODES = ['FAST', 'ENGINEER', 'DEEP_ANALYSIS', 'ARCHITECT', 'DEBUG', 'TEAM', 'EXTREME'] as const;

export interface CommandResult {
  kind: 'result';
  command: string;
  data: unknown;
}

export function CommandBar({
  onJob,
  onResult,
  focusFiles,
  placeholder = 'Ask Vision Code…  (/solve, /debug, /architect, /audit, /prove …)',
  defaultMode = 'ENGINEER',
}: {
  onJob?: (job: Job) => void;
  onResult?: (result: CommandResult) => void;
  focusFiles?: string[];
  placeholder?: string;
  defaultMode?: (typeof MODES)[number];
}) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commands, setCommands] = useState<CommandSpec[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api
      .get<{ commands: CommandSpec[] }>('/api/command')
      .then((response) => setCommands(response.commands))
      .catch(() => setCommands([]));
  }, []);

  const suggestions =
    input.startsWith('/') && !input.includes(' ')
      ? commands.filter((command) => command.name.startsWith(input.slice(1).toLowerCase())).slice(0, 6)
      : [];

  const submit = async (): Promise<void> => {
    const value = input.trim();
    if (value.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<
        { kind: 'job'; job: Job } | { kind: 'result'; command: string; data: unknown }
      >('/api/command', { input: value, mode, focusFiles });
      setInput('');
      if (response.kind === 'job') onJob?.(response.job);
      else onResult?.(response);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.message}${typeof caught.payload.usage === 'string' ? ` — ${caught.payload.usage}` : ''}`
          : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative border-t border-line bg-surface px-3 py-2.5">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-3 mb-2 w-[560px] max-w-[calc(100%-24px)] overflow-hidden rounded-lg border border-line-strong bg-surface-raised shadow-2xl">
          {suggestions.map((command) => (
            <li key={command.name}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-hover"
                onClick={() => {
                  setInput(`/${command.name} `);
                  inputRef.current?.focus();
                }}
              >
                <span className="vc-mono text-[12px] text-accent">/{command.name}</span>
                <span className="text-[11px] text-ink-dim">{command.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mb-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative shrink-0">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as (typeof MODES)[number])}
            className="vc-input appearance-none py-[9px] pr-7 text-[11.5px] font-semibold uppercase tracking-wide"
            aria-label="Run mode"
          >
            {MODES.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint" />
        </div>

        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="vc-input max-h-32 min-h-[38px] resize-y py-2.5"
        />

        <button
          type="button"
          className="vc-button vc-button-primary h-[38px] shrink-0"
          disabled={busy || input.trim().length === 0}
          onClick={() => void submit()}
        >
          <SendHorizontal size={14} />
          {busy ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
  );
}
