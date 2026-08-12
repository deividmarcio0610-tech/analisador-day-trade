'use client';

import clsx from 'clsx';
import { ModeWorkspace } from '@/components/mode-workspace';
import { Empty, Panel } from '@/components/ui/primitives';
import type { JobEvent } from '@/core/types';

interface Hypothesis {
  id: string;
  statement: string;
  status: 'investigating' | 'discarded' | 'probable' | 'confirmed';
  evidence: string;
  nextCheck: string;
}

interface DebugPayload {
  kind?: string;
  payload?: {
    observations: string[];
    hypotheses: Hypothesis[];
    rootCause: string | null;
    fixPlan: string[];
  };
}

const STATUS_STYLE: Record<Hypothesis['status'], string> = {
  investigating: 'border-info/40 text-info',
  discarded: 'border-line-strong text-ink-faint line-through',
  probable: 'border-amber/40 text-amber',
  confirmed: 'border-success/40 text-success',
};

/** DEBUG: hypothesis board built from the evidence the debugger actually read. */
export default function DebugPage() {
  return (
    <ModeWorkspace
      title="Debug"
      description="Evidence first: logs, stack traces, exit codes and files. Hypotheses are ranked, not guessed."
      mode="DEBUG"
      placeholder="Describe the symptom, paste a stack trace or a failing command…"
      render={(stream) => <HypothesisBoard events={stream.events} />}
    />
  );
}

function HypothesisBoard({ events }: { events: JobEvent[] }) {
  const analysis = events
    .filter((event) => event.type === 'agent.message')
    .map((event) => event.payload as DebugPayload)
    .filter((payload) => payload.kind === 'debug')
    .pop()?.payload;

  if (!analysis) {
    return (
      <Panel title="Hypothesis board">
        <Empty>The board fills in once the debugger has read the evidence.</Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Hypothesis board">
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Hypotheses</div>
          {analysis.hypotheses.length === 0 ? (
            <div className="text-[12px] text-ink-faint">none proposed</div>
          ) : (
            analysis.hypotheses.map((hypothesis) => (
              <div key={hypothesis.id} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="vc-mono text-[11px] text-ink-faint">{hypothesis.id}</span>
                  <span className={clsx('vc-tag', STATUS_STYLE[hypothesis.status])}>{hypothesis.status}</span>
                </div>
                <div className="text-[12.5px] text-ink">{hypothesis.statement}</div>
                {hypothesis.evidence && (
                  <div className="mt-1 text-[11.5px] text-ink-dim">evidence: {hypothesis.evidence}</div>
                )}
                {hypothesis.nextCheck && (
                  <div className="mt-0.5 text-[11.5px] text-accent">next: {hypothesis.nextCheck}</div>
                )}
              </div>
            ))
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Observations</div>
          <ul className="mb-3 list-inside list-disc text-[12px] text-ink-dim">
            {analysis.observations.map((observation, index) => (
              <li key={index}>{observation}</li>
            ))}
          </ul>

          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Root cause</div>
          <div
            className={clsx(
              'mb-3 rounded-md border px-3 py-2 text-[12.5px]',
              analysis.rootCause ? 'border-success/30 bg-success/10 text-success' : 'border-line text-ink-faint',
            )}
          >
            {analysis.rootCause ?? 'Not confirmed yet — any fix proposed now is provisional.'}
          </div>

          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Fix plan</div>
          <ol className="list-inside list-decimal text-[12px] text-ink-dim">
            {analysis.fixPlan.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </Panel>
  );
}
