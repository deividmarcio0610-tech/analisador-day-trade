'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Check, CircleDashed, CircleSlash, Loader2, X } from 'lucide-react';
import { DiffView } from './diff-view';
import { Empty, Panel, VerdictBadge } from './ui/primitives';
import { api, formatTime } from '@/lib/api';
import type { JobStreamState } from '@/components/hooks/use-job-stream';

/**
 * AI COUNCIL view: timeline, live agent output, produced patches, review
 * findings and the judge verdict. Everything shown here comes from job events.
 */

export function CouncilView({
  stream,
  jobId,
  onApplied,
}: {
  stream: JobStreamState;
  jobId: string | null;
  onApplied?: () => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <TimelineStrip stream={stream} />
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="grid min-h-0 grid-rows-2 gap-3">
          <AgentStreams stream={stream} />
          <ReviewPanel stream={stream} />
        </div>
        <div className="grid min-h-0 grid-rows-2 gap-3">
          <PatchPanel stream={stream} jobId={jobId} onApplied={onApplied} />
          <JudgePanel stream={stream} />
        </div>
      </div>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  context: 'Context',
  analysis: 'Analysis',
  planning: 'Planning',
  implementation: 'Implementation',
  review: 'Review',
  tests: 'Tests',
  validation: 'Validation',
};

export function TimelineStrip({ stream }: { stream: JobStreamState }) {
  return (
    <div className="vc-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
      {stream.timeline.map((entry) => (
        <div key={entry.stage} className="flex items-center gap-2" title={entry.detail ?? undefined}>
          <StageIcon state={entry.state} />
          <span
            className={clsx(
              'text-[12px]',
              entry.state === 'active'
                ? 'text-accent'
                : entry.state === 'done'
                  ? 'text-ink'
                  : entry.state === 'failed'
                    ? 'text-danger'
                    : 'text-ink-faint',
            )}
          >
            {STAGE_LABEL[entry.stage] ?? entry.stage}
          </span>
          {entry.detail && (
            <span className="max-w-[260px] truncate text-[11px] text-ink-faint">{entry.detail}</span>
          )}
        </div>
      ))}
      {stream.state && <span className="vc-tag ml-auto">{stream.state}</span>}
    </div>
  );
}

function StageIcon({ state }: { state: string }) {
  if (state === 'active') return <Loader2 size={13} className="animate-spin text-accent" />;
  if (state === 'done') return <Check size={13} className="text-success" />;
  if (state === 'failed') return <X size={13} className="text-danger" />;
  if (state === 'skipped') return <CircleSlash size={13} className="text-ink-faint" />;
  return <CircleDashed size={13} className="text-ink-faint" />;
}

function AgentStreams({ stream }: { stream: JobStreamState }) {
  const [active, setActive] = useState(0);
  const agents = stream.agents;

  return (
    <Panel
      title="Agents"
      actions={
        <div className="flex gap-1">
          {agents.map((agent, index) => (
            <button
              key={`${agent.role}-${agent.candidate ?? index}`}
              type="button"
              onClick={() => setActive(index)}
              className={clsx('vc-tag', index === active && 'border-accent/50 text-accent')}
            >
              {agent.role}
              {agent.candidate ? ` ${agent.candidate}` : ''}
            </button>
          ))}
        </div>
      }
      bodyClassName="min-h-0"
    >
      {agents.length === 0 ? (
        <Empty>No agent output yet.</Empty>
      ) : (
        <pre className="vc-scroll vc-mono h-full whitespace-pre-wrap px-4 py-3 leading-relaxed text-ink-dim">
          {agents[Math.min(active, agents.length - 1)]?.text ?? ''}
        </pre>
      )}
    </Panel>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  blocker: 'border-danger/40 text-danger',
  major: 'border-amber/40 text-amber',
  minor: 'border-line-strong text-ink-dim',
  nit: 'border-line-strong text-ink-faint',
};

function ReviewPanel({ stream }: { stream: JobStreamState }) {
  const reviews = stream.reviews;
  return (
    <Panel title="Review findings" bodyClassName="vc-scroll">
      {reviews.length === 0 ? (
        <Empty>The reviewer has not reported yet.</Empty>
      ) : (
        <div className="px-3 py-2">
          {reviews.map((review, index) => (
            <div key={index} className="mb-4">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={clsx(
                    'vc-tag',
                    review.decision === 'REJECTED'
                      ? 'border-danger/40 text-danger'
                      : review.decision === 'APPROVED'
                        ? 'border-success/40 text-success'
                        : 'border-amber/40 text-amber',
                  )}
                >
                  {review.decision.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {review.candidate ? `candidate ${review.candidate}` : `round ${review.round ?? index + 1}`} ·{' '}
                  {review.findings.length} finding(s)
                </span>
              </div>
              {review.findings.map((finding) => (
                <div key={finding.id} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={clsx('vc-tag', SEVERITY_STYLE[finding.severity])}>{finding.severity}</span>
                    <span className="vc-tag">{finding.category}</span>
                    {finding.file && <span className="vc-mono text-[11px] text-ink-faint">{finding.file}</span>}
                  </div>
                  <div className="text-[12.5px] text-ink">{finding.summary}</div>
                  {finding.detail && <p className="mt-1 text-[11.5px] text-ink-dim">{finding.detail}</p>}
                  {finding.suggestedTest && (
                    <p className="mt-1 vc-mono text-[11px] text-accent">test: {finding.suggestedTest}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PatchPanel({
  stream,
  jobId,
  onApplied,
}: {
  stream: JobStreamState;
  jobId: string | null;
  onApplied?: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const patch = stream.patches[stream.patches.length - 1];

  const apply = async (verify: boolean): Promise<void> => {
    if (!patch) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.post<{
        result: { written: string[]; removed: string[]; checkpoint: string | null; errors: Array<{ path: string; error: string }> };
        evidence: Array<{ label: string; verdict: string }>;
      }>(`/api/patches/${patch.patchId}`, { confirmed: true, verify });
      const evidence = response.evidence.map((item) => `${item.label}:${item.verdict}`).join(' ');
      setMessage(
        `Applied ${response.result.written.length} file(s)` +
          (response.result.checkpoint ? ` · checkpoint ${response.result.checkpoint}` : '') +
          (evidence ? ` · ${evidence}` : '') +
          (response.result.errors.length > 0
            ? ` · errors: ${response.result.errors.map((error) => error.path).join(', ')}`
            : ''),
      );
      onApplied?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={patch ? `Patch · +${patch.additions}/-${patch.deletions}` : 'Patch'}
      actions={
        patch && (
          <>
            <button type="button" className="vc-button" disabled={busy} onClick={() => void apply(false)}>
              Apply
            </button>
            <button
              type="button"
              className="vc-button vc-button-primary"
              disabled={busy}
              onClick={() => void apply(true)}
            >
              Apply + verify
            </button>
          </>
        )
      }
      bodyClassName="min-h-0 flex flex-col"
    >
      {!patch ? (
        <Empty>{jobId ? 'No patch produced yet.' : 'Run a task to produce a patch.'}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
            {patch.files.map((file, index) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedFile(index)}
                className={clsx('vc-tag normal-case', index === selectedFile && 'border-accent/50 text-accent')}
              >
                <span className="vc-mono">{file.path}</span>
                <span className="text-success">+{file.additions}</span>
                <span className="text-danger">-{file.deletions}</span>
              </button>
            ))}
          </div>
          {patch.impact && (
            <div className="border-b border-line px-3 py-2 text-[11px] whitespace-pre-wrap text-ink-faint">
              {patch.impact}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <DiffView patch={patch.files[selectedFile]?.patch ?? ''} maxHeight={9999} />
          </div>
          {message && <div className="border-t border-line px-3 py-2 text-[11.5px] text-ink-dim">{message}</div>}
        </>
      )}
    </Panel>
  );
}

function JudgePanel({ stream }: { stream: JobStreamState }) {
  const judge = stream.judge;
  return (
    <Panel
      title="Engineering judge"
      actions={judge && <VerdictBadge verdict={judge.verdict} />}
      bodyClassName="vc-scroll"
    >
      {!judge && stream.evidence.length === 0 ? (
        <Empty>No verdict yet. The judge only decides from checks that actually ran.</Empty>
      ) : (
        <div className="px-4 py-3">
          {judge && (
            <div className="mb-3 flex items-center gap-3">
              <span className="text-[26px] font-semibold tabular-nums">{judge.score}</span>
              <span className="text-[11px] text-ink-faint">score from executed evidence</span>
            </div>
          )}
          <table className="w-full text-left text-[12px]">
            <tbody>
              {(judge?.evidence ?? stream.evidence).map((item, index) => (
                <tr key={`${item.label}-${index}`} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 vc-mono text-ink-dim">{item.label}</td>
                  <td className="py-1.5 pr-3">
                    <VerdictBadge verdict={item.verdict} />
                  </td>
                  <td className="py-1.5 text-ink-faint">{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {judge && judge.blockers.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-danger">Blockers</div>
              <ul className="list-inside list-disc text-[12px] text-ink-dim">
                {judge.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          {judge && judge.notes.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Notes</div>
              <ul className="list-inside list-disc text-[12px] text-ink-faint">
                {judge.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          {stream.logs.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              {stream.logs.slice(-8).map((log, index) => (
                <div key={index} className="text-[11px] text-ink-faint">
                  <span className="vc-mono">{formatTime(log.at)}</span> {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
