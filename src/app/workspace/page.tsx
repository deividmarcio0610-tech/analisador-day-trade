'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { Save, X, Search as SearchIcon } from 'lucide-react';
import { FileExplorer } from '@/components/file-explorer';
import { TerminalPanel } from '@/components/terminal-panel';
import { LogsPanel } from '@/components/logs-panel';
import { DiffView } from '@/components/diff-view';
import { CommandBar } from '@/components/command-bar';
import { CouncilView } from '@/components/council-view';
import { useJobStream } from '@/components/hooks/use-job-stream';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, Panel, Spinner, VerdictBadge } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { EvidenceItem } from '@/core/types';
import type { SystemStatus } from '@/lib/types';

const CodeEditor = dynamic(() => import('@/components/code-editor').then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner label="loading editor" />
    </div>
  ),
});

/** WORKSPACE: explorer + editor + council, with terminal/problems/logs/diff below. */

interface OpenTab {
  path: string;
  content: string;
  saved: string;
}

type BottomTab = 'terminal' | 'problems' | 'tests' | 'logs' | 'diff' | 'output';

export default function WorkspacePage() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [bottom, setBottom] = useState<BottomTab>('terminal');
  const [jobId, setJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'council' | 'search'>('council');

  const system = usePoll<SystemStatus>('/api/system', 20_000);
  const stream = useJobStream(jobId);
  const active = tabs.find((tab) => tab.path === activePath) ?? null;
  const changedPaths = system.data?.git.files.map((file) => file.path) ?? [];

  const open = useCallback(
    async (path: string): Promise<void> => {
      setActivePath(path);
      if (tabs.some((tab) => tab.path === path)) return;
      try {
        const file = await api.get<{ path: string; content: string; binary: boolean }>(
          `/api/fs/file?path=${encodeURIComponent(path)}`,
        );
        const content = file.binary ? '' : file.content;
        setTabs((previous) => [...previous, { path, content, saved: content }]);
        if (file.binary) setNotice(`${path} is a binary file and cannot be edited here.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [tabs],
  );

  const save = useCallback(async (): Promise<void> => {
    if (!active) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.put('/api/fs/file', { path: active.path, content: active.content });
      setTabs((previous) =>
        previous.map((tab) => (tab.path === active.path ? { ...tab, saved: tab.content } : tab)),
      );
      void system.refresh();
      setNotice(`Saved ${active.path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [active, system]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[228px_minmax(0,1fr)_360px] gap-2 p-2">
        <div className="vc-panel min-h-0">
          <FileExplorer onOpen={(path) => void open(path)} activePath={activePath} changedPaths={changedPaths} />
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2">
          <div className="vc-panel flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
              {tabs.length === 0 && <span className="px-2 text-[11.5px] text-ink-faint">No file open</span>}
              {tabs.map((tab) => (
                <div
                  key={tab.path}
                  className={clsx(
                    'flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11.5px]',
                    tab.path === activePath ? 'bg-surface-hover text-ink' : 'text-ink-dim hover:bg-surface-hover',
                  )}
                >
                  <button type="button" onClick={() => setActivePath(tab.path)} className="vc-mono">
                    {tab.path.split('/').pop()}
                    {tab.content !== tab.saved && <span className="ml-1 text-amber">●</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTabs((previous) => previous.filter((item) => item.path !== tab.path));
                      if (activePath === tab.path) setActivePath(null);
                    }}
                    className="text-ink-faint hover:text-danger"
                    aria-label={`Close ${tab.path}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {active && (
                <button
                  type="button"
                  className="vc-button ml-auto shrink-0 py-1"
                  disabled={saving || active.content === active.saved}
                  onClick={() => void save()}
                >
                  <Save size={12} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>

            {notice && (
              <div className="shrink-0 border-b border-line px-3 py-1.5 text-[11.5px] text-ink-dim">{notice}</div>
            )}

            <div className="min-h-0 flex-1">
              {active ? (
                <CodeEditor
                  path={active.path}
                  value={active.content}
                  onChange={(value) =>
                    setTabs((previous) =>
                      previous.map((tab) => (tab.path === active.path ? { ...tab, content: value } : tab)),
                    )
                  }
                  onSave={() => void save()}
                />
              ) : (
                <Empty>Select a file in the explorer.</Empty>
              )}
            </div>
          </div>

          <div className="vc-panel flex min-h-0 flex-col">
            <div className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5">
              {(['terminal', 'problems', 'tests', 'logs', 'diff', 'output'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setBottom(tab)}
                  className={clsx(
                    'rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
                    bottom === tab ? 'bg-surface-hover text-accent' : 'text-ink-faint hover:text-ink',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {bottom === 'terminal' && <TerminalPanel />}
              {bottom === 'logs' && <LogsPanel />}
              {bottom === 'problems' && <ProblemsPanel />}
              {bottom === 'tests' && <ChecksPanel />}
              {bottom === 'diff' && <WorkspaceDiff />}
              {bottom === 'output' && (
                <pre className="vc-scroll vc-mono h-full whitespace-pre-wrap px-3 py-2 text-ink-dim">
                  {stream.agents.map((agent) => `--- ${agent.role} ---\n${agent.text}`).join('\n\n') ||
                    'Agent output appears here while a job runs.'}
                </pre>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 gap-1">
            {(['council', 'search'] as const).map((panel) => (
              <button
                key={panel}
                type="button"
                onClick={() => setRightPanel(panel)}
                className={clsx('vc-tag', rightPanel === panel && 'border-accent/50 text-accent')}
              >
                {panel}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {rightPanel === 'council' ? (
              jobId ? (
                <div className="h-full overflow-hidden">
                  <CouncilView stream={stream} jobId={jobId} />
                </div>
              ) : (
                <Panel title="AI Council">
                  <Empty>Run a task from the prompt bar to see the council here.</Empty>
                </Panel>
              )
            ) : (
              <SearchPanel onOpen={(path) => void open(path)} />
            )}
          </div>
        </div>
      </div>

      <CommandBar
        onJob={(job) => setJobId(job.id)}
        focusFiles={active ? [active.path] : undefined}
        placeholder={
          active ? `Ask about ${active.path}…  (/solve, /debug, /review)` : 'Ask Vision Code…  (/solve, /debug)'
        }
      />
    </div>
  );
}

function ProblemsPanel() {
  const { data, loading } = usePoll<{
    debt: { markers: Array<{ path: string; line: number; kind: string; text: string }>; circularImports: string[][] };
  }>('/api/quality?scope=debt', 0);

  if (loading) return <div className="p-3"><Spinner label="scanning" /></div>;
  const markers = data?.debt.markers ?? [];
  const cycles = data?.debt.circularImports ?? [];

  if (markers.length === 0 && cycles.length === 0) return <Empty>No markers or import cycles found.</Empty>;

  return (
    <div className="vc-scroll h-full px-3 py-2 text-[12px]">
      {cycles.map((cycle, index) => (
        <div key={`cycle-${index}`} className="mb-1 text-danger">
          circular import: <span className="vc-mono">{cycle.join(' → ')}</span>
        </div>
      ))}
      {markers.map((marker, index) => (
        <div key={index} className="mb-0.5 flex gap-2">
          <span className={marker.kind === 'FIXME' ? 'text-danger' : 'text-amber'}>{marker.kind}</span>
          <span className="vc-mono text-ink-faint">
            {marker.path}:{marker.line}
          </span>
          <span className="text-ink-dim">{marker.text}</span>
        </div>
      ))}
    </div>
  );
}

function ChecksPanel() {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const { data } = usePoll<{ commands: Record<string, string | null> }>('/api/checks', 0);

  const run = async (kind: string): Promise<void> => {
    setRunning(kind);
    try {
      const item = await api.post<EvidenceItem>('/api/checks', { kind });
      setEvidence((previous) => [item, ...previous]);
    } catch (error) {
      setEvidence((previous) => [
        {
          kind: 'test',
          label: kind,
          verdict: 'BLOCKED',
          summary: error instanceof Error ? error.message : String(error),
        },
        ...previous,
      ]);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-line px-3 py-2">
        {(['lint', 'typecheck', 'test', 'e2e', 'build'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="vc-button py-1"
            disabled={running !== null || !data?.commands[kind]}
            title={data?.commands[kind] ?? 'not detected'}
            onClick={() => void run(kind)}
          >
            {kind}
          </button>
        ))}
        {running && <Spinner label={running} />}
      </div>
      <div className="vc-scroll min-h-0 flex-1 px-3 py-2">
        {evidence.length === 0 ? (
          <Empty>No checks run in this session.</Empty>
        ) : (
          evidence.map((item, index) => (
            <div key={index} className="mb-2 border-b border-line pb-2 last:border-0">
              <div className="mb-1 flex items-center gap-2">
                <VerdictBadge verdict={item.verdict} />
                <span className="vc-mono text-[11.5px] text-ink-dim">{item.command}</span>
                <span className="text-[11px] text-ink-faint">{item.summary}</span>
              </div>
              {item.output && (
                <pre className="vc-scroll vc-mono max-h-40 whitespace-pre-wrap text-[11px] text-ink-faint">
                  {item.output}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WorkspaceDiff() {
  const { data, loading } = usePoll<{
    available: boolean;
    files: Array<{ path: string; additions: number; deletions: number; patch: string }>;
  }>('/api/git?section=diff', 8_000);
  const [selected, setSelected] = useState(0);

  if (loading) return <div className="p-3"><Spinner label="reading diff" /></div>;
  if (!data?.available) return <Empty>Not a git repository.</Empty>;
  if (data.files.length === 0) return <Empty>Working tree is clean.</Empty>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2 py-1.5">
        {data.files.map((file, index) => (
          <button
            key={file.path}
            type="button"
            onClick={() => setSelected(index)}
            className={clsx('vc-tag normal-case', index === selected && 'border-accent/50 text-accent')}
          >
            <span className="vc-mono">{file.path}</span>
            <span className="text-success">+{file.additions}</span>
            <span className="text-danger">-{file.deletions}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <DiffView patch={data.files[selected]?.patch ?? ''} maxHeight={9999} />
      </div>
    </div>
  );
}

function SearchPanel({ onOpen }: { onOpen: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Array<{ path: string; line: number; text: string }>>([]);
  const [busy, setBusy] = useState(false);

  const search = async (): Promise<void> => {
    if (query.trim().length === 0) return;
    setBusy(true);
    try {
      const response = await api.post<{ matches: Array<{ path: string; line: number; text: string }> }>(
        '/api/fs/search',
        { query },
      );
      setMatches(response.matches);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Search" bodyClassName="flex min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 px-3 py-2">
        <input
          className="vc-input"
          value={query}
          placeholder="text or identifier"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void search()}
        />
        <button type="button" className="vc-button" disabled={busy} onClick={() => void search()}>
          <SearchIcon size={13} />
        </button>
      </div>
      <div className="vc-scroll min-h-0 flex-1 px-2 pb-2">
        {matches.length === 0 ? (
          <Empty>{busy ? 'Searching…' : 'No results yet.'}</Empty>
        ) : (
          matches.map((match, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onOpen(match.path)}
              className="mb-0.5 block w-full rounded px-2 py-1 text-left hover:bg-surface-hover"
            >
              <div className="vc-mono text-[11px] text-accent">
                {match.path}:{match.line}
              </div>
              <div className="vc-mono truncate text-[11px] text-ink-faint">{match.text.trim()}</div>
            </button>
          ))
        )}
      </div>
    </Panel>
  );
}
