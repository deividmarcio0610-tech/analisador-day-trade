'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ModeWorkspace } from '@/components/mode-workspace';
import { CodeGraphView } from '@/components/code-graph-view';
import { Empty, Panel } from '@/components/ui/primitives';
import type { PlanPayloadView } from '@/lib/types';

/** ARCHITECT: design output plus the navigable code graph of the current system. */
export default function ArchitectPage() {
  const [tab, setTab] = useState<'design' | 'graph'>('design');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-line bg-surface px-3 py-2">
        {(['design', 'graph'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={clsx(
              'rounded px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide',
              tab === value ? 'bg-surface-hover text-accent' : 'text-ink-faint hover:text-ink',
            )}
          >
            {value === 'design' ? 'Design' : 'Code graph'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'design' ? (
          <ModeWorkspace
            title="Architect"
            description="Requirements, constraints and implementation order before any code is written."
            mode="ARCHITECT"
            placeholder="Describe what should be designed…"
            render={(stream) => <DesignView plan={stream.plan} />}
          />
        ) : (
          <div className="h-full p-3">
            <CodeGraphView />
          </div>
        )}
      </div>
    </div>
  );
}

function DesignView({ plan }: { plan: PlanPayloadView | null }) {
  if (!plan) {
    return (
      <Panel title="Design">
        <Empty>The design appears here once the architect answers.</Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Design">
      <div className="vc-scroll max-h-[420px] px-4 py-3">
        <p className="mb-3 text-[12.5px] text-ink-dim">{plan.summary}</p>

        {plan.requirements.length > 0 && (
          <>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Requirements (spec-first)
            </div>
            <table className="mb-4 w-full text-left text-[12px]">
              <tbody>
                {plan.requirements.map((requirement) => (
                  <tr key={requirement.id} className="border-b border-line last:border-0">
                    <td className="w-24 py-1.5 pr-2 vc-mono text-accent">{requirement.id}</td>
                    <td className="py-1.5 pr-2 text-ink">{requirement.statement}</td>
                    <td className="py-1.5 text-ink-faint">{requirement.verification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {plan.sections && plan.sections.length > 0 && (
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            {plan.sections.map((section) => (
              <div key={section.title} className="rounded-md border border-line bg-surface-raised px-3 py-2">
                <div className="mb-1 text-[12px] font-semibold text-ink">{section.title}</div>
                <p className="whitespace-pre-wrap text-[11.5px] text-ink-dim">{section.content}</p>
              </div>
            ))}
          </div>
        )}

        {plan.steps.length > 0 && (
          <>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Implementation order
            </div>
            <ol className="mb-4 list-inside list-decimal text-[12px] text-ink-dim">
              {plan.steps.map((step) => (
                <li key={step.id} className="mb-1">
                  <span className="text-ink">{step.title}</span>
                  {step.detail && <span> — {step.detail}</span>}
                  {step.files.length > 0 && (
                    <span className="vc-mono text-[11px] text-ink-faint"> [{step.files.join(', ')}]</span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {plan.risks.length > 0 && (
          <>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber">Risks</div>
            <ul className="list-inside list-disc text-[12px] text-ink-dim">
              {plan.risks.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
