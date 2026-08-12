'use client';

import { useState } from 'react';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, Spinner, VerdictBadge } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { EvidenceItem } from '@/core/types';
import type { SystemStatus } from '@/lib/types';

/**
 * DEPLOY
 *
 * Vision does not ship a deployment integration, and does not pretend to. What
 * it can do honestly is run the project's own build and report the result; the
 * release step stays with whatever pipeline the project already uses.
 */
export default function DeployPage() {
  const system = usePoll<SystemStatus>('/api/system', 0);
  const [building, setBuilding] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = async (): Promise<void> => {
    setBuilding(true);
    setError(null);
    try {
      setEvidence(await api.post<EvidenceItem>('/api/checks', { kind: 'build' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBuilding(false);
    }
  };

  const buildCommand = system.data?.stack.commands.build ?? null;

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={system.error ?? error} />

      <Panel title="Deployment integration" className="mb-3">
        <div className="px-4 py-3 text-[12.5px] text-ink-dim">
          <span className="vc-tag border-amber/40 text-amber">NOT CONFIGURED</span>
          <p className="mt-2">
            No deployment target is configured for this workspace and Vision will not invent one. Releases stay with
            the pipeline the project already uses; wire one up here when a target exists.
          </p>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Deploy commands, when they exist, are ordinary shell commands — run them from the Workspace terminal where
            they are classified, logged and auditable.
          </p>
        </div>
      </Panel>

      <Panel
        title="Release build"
        actions={
          <button type="button" className="vc-button" disabled={building || !buildCommand} onClick={() => void build()}>
            {building ? 'Building…' : 'Run build'}
          </button>
        }
      >
        <div className="px-4 py-3">
          {!buildCommand ? (
            <Empty>No build command detected in this project.</Empty>
          ) : (
            <div className="text-[12px] text-ink-dim">
              Command: <span className="vc-mono text-ink">{buildCommand}</span>
            </div>
          )}
          {building && <div className="mt-3"><Spinner label="running build" /></div>}
          {evidence && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2">
                <VerdictBadge verdict={evidence.verdict} />
                <span className="text-[11.5px] text-ink-faint">{evidence.summary}</span>
              </div>
              {evidence.output && (
                <pre className="vc-scroll vc-mono max-h-72 whitespace-pre-wrap rounded border border-line bg-void px-3 py-2 text-[11px] text-ink-faint">
                  {evidence.output}
                </pre>
              )}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
