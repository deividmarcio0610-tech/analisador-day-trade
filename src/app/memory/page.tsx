'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel } from '@/components/ui/primitives';
import { api, formatTime } from '@/lib/api';

interface MemoryResponse {
  memories: Array<{ id: string; kind: string; title: string; body: string; tags: string[]; updatedAt: string }>;
  failures: Array<{
    id: string;
    problem: string;
    attempt: string;
    result: string;
    cause: string;
    validSolution: string | null;
    test: string | null;
    createdAt: string;
  }>;
  decisions: Array<{
    id: string;
    decision: string;
    alternatives: string[];
    reason: string;
    evidence: string;
    consequences: string;
    createdAt: string;
  }>;
}

const KINDS = [
  'architecture', 'convention', 'decision', 'problem', 'solution',
  'component', 'infrastructure', 'test', 'history',
] as const;

const TABS = ['memories', 'failures', 'decisions'] as const;

/** MEMORY: project knowledge, failed approaches and the decision journal. */
export default function MemoryPage() {
  const { data, error, refresh } = usePoll<MemoryResponse>('/api/memory', 0);
  const [tab, setTab] = useState<(typeof TABS)[number]>('memories');
  const [form, setForm] = useState({ kind: 'architecture' as (typeof KINDS)[number], title: '', body: '', tags: '' });
  const [busy, setBusy] = useState(false);

  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post('/api/memory', {
        scope: 'memory',
        kind: form.kind,
        title: form.title,
        body: form.body,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setForm({ kind: form.kind, title: '', body: '', tags: '' });
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />

      <div className="mb-3 flex gap-2">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={clsx('vc-tag', tab === value && 'border-accent/50 text-accent')}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'memories' && (
        <>
          <Panel title={`Project memory · ${data?.memories.length ?? 0}`} className="mb-3">
            {(data?.memories.length ?? 0) === 0 ? (
              <Empty>Nothing remembered yet. The council reads this before planning.</Empty>
            ) : (
              <div className="px-4 py-3">
                {data?.memories.map((memory) => (
                  <div key={memory.id} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="vc-tag">{memory.kind}</span>
                      <span className="text-[12.5px] text-ink">{memory.title}</span>
                      <span className="ml-auto text-[10.5px] text-ink-faint">{formatTime(memory.updatedAt)}</span>
                      <button
                        type="button"
                        className="text-[11px] text-ink-faint hover:text-danger"
                        onClick={async () => {
                          await api.del('/api/memory', { id: memory.id });
                          void refresh();
                        }}
                      >
                        remove
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-[11.5px] text-ink-dim">{memory.body}</p>
                    {memory.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {memory.tags.map((tag) => (
                          <span key={tag} className="vc-tag normal-case">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Remember something">
            <div className="grid gap-3 px-4 py-3 md:grid-cols-4">
              <label className="text-[11.5px] text-ink-dim">
                Kind
                <select
                  className="vc-input mt-1"
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value as (typeof KINDS)[number] })}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11.5px] text-ink-dim md:col-span-2">
                Title
                <input
                  className="vc-input mt-1"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </label>
              <label className="text-[11.5px] text-ink-dim">
                Tags (comma separated)
                <input
                  className="vc-input mt-1"
                  value={form.tags}
                  onChange={(event) => setForm({ ...form, tags: event.target.value })}
                />
              </label>
              <label className="text-[11.5px] text-ink-dim md:col-span-4">
                Body
                <textarea
                  rows={3}
                  className="vc-input mt-1"
                  value={form.body}
                  onChange={(event) => setForm({ ...form, body: event.target.value })}
                />
              </label>
            </div>
            <div className="border-t border-line px-4 py-2.5">
              <button
                type="button"
                className="vc-button vc-button-primary"
                disabled={busy || !form.title || !form.body}
                onClick={() => void add()}
              >
                Save to memory
              </button>
            </div>
          </Panel>
        </>
      )}

      {tab === 'failures' && (
        <Panel title={`Failure memory · ${data?.failures.length ?? 0}`}>
          {(data?.failures.length ?? 0) === 0 ? (
            <Empty>No failed approach recorded. Entries are written automatically when a round fails.</Empty>
          ) : (
            <div className="px-4 py-3">
              {data?.failures.map((failure) => (
                <div key={failure.id} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2 text-[12px]">
                  <div className="mb-1 text-ink">{failure.problem}</div>
                  <div className="text-ink-dim">attempt: {failure.attempt}</div>
                  <div className="text-danger">result: {failure.result}</div>
                  <div className="text-ink-dim">cause: {failure.cause}</div>
                  {failure.validSolution && <div className="text-success">solution: {failure.validSolution}</div>}
                  {failure.test && <div className="vc-mono text-[11px] text-accent">test: {failure.test}</div>}
                  <div className="mt-1 text-[10.5px] text-ink-faint">{formatTime(failure.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'decisions' && (
        <Panel title={`Decision journal · ${data?.decisions.length ?? 0}`}>
          {(data?.decisions.length ?? 0) === 0 ? (
            <Empty>No decision recorded yet.</Empty>
          ) : (
            <div className="px-4 py-3">
              {data?.decisions.map((decision) => (
                <div key={decision.id} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2 text-[12px]">
                  <div className="mb-1 text-ink">{decision.decision}</div>
                  <div className="text-ink-dim">reason: {decision.reason}</div>
                  {decision.alternatives.length > 0 && (
                    <div className="text-ink-faint">alternatives: {decision.alternatives.join(' · ')}</div>
                  )}
                  {decision.evidence && (
                    <pre className="mt-1 whitespace-pre-wrap vc-mono text-[11px] text-ink-faint">{decision.evidence}</pre>
                  )}
                  {decision.consequences && <div className="text-ink-dim">consequences: {decision.consequences}</div>}
                  <div className="mt-1 text-[10.5px] text-ink-faint">{formatTime(decision.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
