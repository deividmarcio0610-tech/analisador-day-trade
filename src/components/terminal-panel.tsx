'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import type { CommandRisk, ProcessResult } from '@/core/types';

/**
 * TERMINAL
 *
 * Commands run on the host where the Vision agent lives. Output is streamed
 * from the server; CRITICAL commands are refused until the user confirms.
 */

interface Line {
  stream: 'input' | 'stdout' | 'stderr' | 'system';
  text: string;
}

export function TerminalPanel({ cwd }: { cwd?: string }) {
  const [lines, setLines] = useState<Line[]>([
    { stream: 'system', text: 'Vision terminal ready. Commands run on the agent host.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pending, setPending] = useState<{ commandLine: string; reasons: string[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource('/api/terminal/stream');
    const onData = (event: MessageEvent<string>): void => {
      try {
        const payload = JSON.parse(event.data) as { stream: 'stdout' | 'stderr'; chunk: string };
        setLines((previous) => [...previous, { stream: payload.stream, text: payload.chunk }]);
      } catch {
        // ignore malformed frame
      }
    };
    source.addEventListener('data', onData as EventListener);
    return () => {
      source.removeEventListener('data', onData as EventListener);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const run = async (commandLine: string, confirmed: boolean): Promise<void> => {
    setBusy(true);
    setLines((previous) => [...previous, { stream: 'input', text: `$ ${commandLine}` }]);
    try {
      const result = await api.post<ProcessResult & { risk: CommandRisk }>('/api/terminal', {
        commandLine,
        cwd,
        confirmed,
      });
      setLines((previous) => [
        ...previous,
        {
          stream: result.exitCode === 0 ? 'system' : 'stderr',
          text: `exit ${result.exitCode ?? 'null'} · ${result.durationMs} ms${result.timedOut ? ' · TIMED OUT' : ''}`,
        },
      ]);
      setPending(null);
    } catch (error) {
      if (error instanceof ApiError && error.payload.requiresConfirmation === true) {
        setPending({
          commandLine,
          reasons: Array.isArray(error.payload.reasons) ? (error.payload.reasons as string[]) : [],
        });
        setLines((previous) => [
          ...previous,
          { stream: 'stderr', text: `blocked: ${error.message}` },
        ]);
      } else {
        setLines((previous) => [
          ...previous,
          { stream: 'stderr', text: error instanceof Error ? error.message : String(error) },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    const value = input.trim();
    if (!value || busy) return;
    setHistory((previous) => [value, ...previous].slice(0, 50));
    setHistoryIndex(-1);
    setInput('');

    // Classify before executing so a destructive command is held up front
    // instead of after a round trip.
    try {
      const verdict = await api.post<{
        risk: CommandRisk;
        reasons: string[];
        requiresConfirmation: boolean;
      }>('/api/terminal/classify', { commandLine: value });
      if (verdict.requiresConfirmation) {
        setPending({ commandLine: value, reasons: verdict.reasons });
        setLines((previous) => [
          ...previous,
          { stream: 'input', text: `$ ${value}` },
          { stream: 'stderr', text: `held as ${verdict.risk}: ${verdict.reasons.join(', ')}` },
        ]);
        return;
      }
    } catch {
      // Classification is an early warning; the server enforces the rule anyway.
    }

    void run(value, false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="vc-scroll vc-mono min-h-0 flex-1 px-3 py-2 leading-[1.5]">
        {lines.map((line, index) => (
          <div
            key={index}
            className={clsx(
              'whitespace-pre-wrap break-words',
              line.stream === 'input' && 'text-accent',
              line.stream === 'stderr' && 'text-danger',
              line.stream === 'system' && 'text-ink-faint',
              line.stream === 'stdout' && 'text-ink-dim',
            )}
          >
            {line.text}
          </div>
        ))}
      </div>

      {pending && (
        <div className="border-t border-amber/30 bg-amber/10 px-3 py-2 text-[11.5px] text-amber">
          <div className="mb-1.5">
            CRITICAL command held: <span className="vc-mono">{pending.commandLine}</span>
            {pending.reasons.length > 0 && <> — {pending.reasons.join(', ')}</>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="vc-button vc-button-danger"
              onClick={() => void run(pending.commandLine, true)}
            >
              Run anyway
            </button>
            <button type="button" className="vc-button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="vc-mono text-accent">$</span>
        <input
          value={input}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
            else if (event.key === 'ArrowUp') {
              event.preventDefault();
              const next = Math.min(historyIndex + 1, history.length - 1);
              if (next >= 0) {
                setHistoryIndex(next);
                setInput(history[next] ?? '');
              }
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              const next = historyIndex - 1;
              setHistoryIndex(next);
              setInput(next >= 0 ? (history[next] ?? '') : '');
            }
          }}
          placeholder={busy ? 'running…' : 'npm run test, git status, python -m pytest …'}
          className="vc-mono flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
    </div>
  );
}
