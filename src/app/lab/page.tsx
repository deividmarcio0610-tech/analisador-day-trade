'use client';

import { ModeWorkspace } from '@/components/mode-workspace';
import { Panel } from '@/components/ui/primitives';

/**
 * LAB: EXTREME mode. Two candidate solutions are produced independently, cross
 * reviewed, and — when verification is requested — built and tested inside
 * separate git worktrees so the main tree is never touched.
 */
export default function LabPage() {
  return (
    <ModeWorkspace
      title="Lab"
      description="Independent candidates, cross review, isolated verification. The evidence picks the winner."
      mode="EXTREME"
      placeholder="Describe the problem to solve two different ways…"
      header={
        <Panel title="How the tournament decides" className="mb-3">
          <ul className="list-inside list-disc px-4 py-3 text-[12px] text-ink-dim">
            <li>Candidate A optimises for the smallest correct change; candidate B is free to restructure.</li>
            <li>Each candidate is reviewed by the reviewer model in challenge mode.</li>
            <li>
              With <span className="vc-mono">/lab</span> the candidates are written into separate git worktrees and the
              project checks run there — the main working tree is not modified.
            </li>
            <li>Score = executed checks, then review severity, then patch size. Ties are reported, not broken.</li>
          </ul>
        </Panel>
      }
    />
  );
}
