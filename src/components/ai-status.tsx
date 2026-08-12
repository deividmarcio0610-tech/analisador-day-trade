'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { RefreshCw, Zap } from 'lucide-react';
import { usePoll } from './hooks/use-poll';
import { Empty, Panel, Spinner, StatusDot } from './ui/primitives';
import { api, formatDuration, formatTime } from '@/lib/api';
import type { AiStatusView, PipelineCheckView } from '@/lib/types';

/**
 * Real status of the council's models.
 *
 * Nothing here is derived from configuration alone: the endpoint state comes
 * from a probe, and a role only reads ONLINE after its model answered a real
 * completion. When the GPU is unreachable the banner says so and the rest of the
 * platform keeps working.
 */

const ROLE_LABEL: Record<string, string> = {
  builder: 'Builder',
  reviewer: 'Reviewer',
  planner: 'Planner',
};

export function AiStatusBar({ compact = false }: { compact?: boolean }) {
  const { data, error, refresh, loading } = usePoll<AiStatusView>(
    '/api/ai/diagnostics?verify=false',
    30_000,
  );
  const [verifying, setVerifying] = useState(false);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    try {
      await api.get<AiStatusView>('/api/ai/diagnostics');
      await refresh();
    } finally {
      setVerifying(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="vc-panel px-4 py-2.5">
        <Spinner label="checking models" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="vc-panel border-danger/30 px-4 py-2.5 text-[12px] text-danger">
        {error ?? 'AI status unavailable'}
      </div>
    );
  }

  const unavailable = data.server.status !== 'ONLINE';

  return (
    <div className="vc-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <span className="flex items-center gap-2 text-[12px]">
        <StatusDot status={data.server.status} />
        <span className="text-ink-dim">Endpoint</span>
        <span className="vc-mono text-[11px] text-ink-faint">
          {data.provider.endpointConfigured ? data.provider.maskedEndpoint : 'not configured'}
        </span>
        {data.provider.resolvedKind && <span className="vc-tag">{data.provider.resolvedKind}</span>}
      </span>

      {data.roles.map((role) => (
        <span key={role.role} className="flex items-center gap-2 text-[12px]" title={role.detail}>
          <StatusDot status={role.status} />
          <span className="text-ink-dim">{ROLE_LABEL[role.role] ?? role.role}</span>
          <span className="vc-mono text-[11px] text-ink-faint">{role.model || 'no model'}</span>
          {role.latencyMs !== null && (
            <span className="text-[10.5px] text-ink-faint">{formatDuration(role.latencyMs)}</span>
          )}
        </span>
      ))}

      <span className="flex items-center gap-2 text-[12px]" title={data.judge.detail}>
        <StatusDot status={data.judge.status === 'READY' ? 'ONLINE' : 'NOT_CONFIGURED'} />
        <span className="text-ink-dim">Judge</span>
        <span className={clsx('vc-tag', data.judge.status === 'READY' ? 'text-success' : 'text-amber')}>
          {data.judge.status}
        </span>
      </span>

      <div className="ml-auto flex items-center gap-2">
        {verifying && <Spinner />}
        <button type="button" className="vc-button py-1" disabled={verifying} onClick={() => void verify()}>
          <Zap size={12} />
          Verify models
        </button>
        <button type="button" className="vc-button py-1" onClick={() => void refresh()} aria-label="Refresh status">
          <RefreshCw size={12} />
        </button>
      </div>

      {unavailable && !compact && (
        <div className="w-full rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-[11.5px] text-amber">
          <strong>GPU/MODEL UNAVAILABLE</strong> — {data.server.detail}. Council runs are blocked; the
          workspace, terminal, git, tests and analysis keep working.
        </div>
      )}
    </div>
  );
}

/** Full diagnostics panel: endpoint, models, latency, last failure. No secrets. */
export function AiDiagnosticsPanel() {
  const { data, error, refresh, loading } = usePoll<AiStatusView>('/api/ai/diagnostics?verify=false', 0);
  const [check, setCheck] = useState<PipelineCheckView | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTestError(null);
    setCheck(null);
    try {
      setCheck(await api.post<PipelineCheckView>('/api/ai/test'));
    } catch (caught) {
      // A failing pipeline answers 503 with the stage detail; show it as data.
      const payload = (caught as { payload?: PipelineCheckView }).payload;
      if (payload && Array.isArray(payload.stages)) setCheck(payload);
      else setTestError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
      void refresh();
    }
  };

  return (
    <Panel
      title="Remote GPU diagnostics"
      actions={
        <>
          <button type="button" className="vc-button py-1" onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            type="button"
            className="vc-button vc-button-primary py-1"
            disabled={testing}
            onClick={() => void runTest()}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </>
      }
    >
      {loading && !data && (
        <div className="p-4">
          <Spinner label="probing endpoint" />
        </div>
      )}
      {error && <div className="px-4 py-3 text-[12px] text-danger">{error}</div>}

      {data && (
        <div className="px-4 py-3 text-[12px]">
          <table className="w-full text-left">
            <tbody>
              <Row label="Provider" value={`${data.provider.label} (${data.provider.id})`} />
              <Row
                label="Endpoint"
                value={
                  data.provider.endpointConfigured ? (
                    <span className="vc-mono">{data.provider.maskedEndpoint}</span>
                  ) : (
                    <span className="text-amber">NOT CONFIGURED</span>
                  )
                }
              />
              <Row
                label="Dialect"
                value={
                  data.provider.resolvedKind
                    ? `${data.provider.resolvedKind} (detected${
                        data.server.probedPath ? ` on ${data.server.probedPath}` : ''
                      })`
                    : `${data.provider.kind} (assumed, not confirmed)`
                }
              />
              <Row
                label="Server"
                value={
                  <span className="flex items-center gap-2">
                    <StatusDot status={data.server.status} />
                    {data.server.status} · {data.server.detail}
                  </span>
                }
              />
              <Row label="Latency" value={formatDuration(data.server.latencyMs)} />
              <Row label="Timeout" value={formatDuration(data.provider.timeoutMs)} />
              <Row
                label="API key"
                value={
                  data.provider.apiKeyEnv
                    ? data.provider.apiKeyConfigured
                      ? `${data.provider.apiKeyEnv} is set on the server`
                      : `${data.provider.apiKeyEnv} is not set (endpoint treated as open)`
                    : 'not required'
                }
              />
              <Row
                label="Models on server"
                value={
                  data.server.models.length === 0 ? (
                    <span className="text-ink-faint">none reported</span>
                  ) : (
                    <span className="vc-mono text-[11px]">{data.server.models.slice(0, 8).join(', ')}</span>
                  )
                }
              />
              {data.roles.map((role) => (
                <Row
                  key={role.role}
                  label={ROLE_LABEL[role.role] ?? role.role}
                  value={
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusDot status={role.status} />
                      <span className="vc-mono">{role.model || 'no model'}</span>
                      <span className="text-ink-faint">{role.detail}</span>
                      {role.reportedModel && (
                        <span className="vc-tag normal-case">answered as {role.reportedModel}</span>
                      )}
                    </span>
                  }
                />
              ))}
              <Row
                label="Judge"
                value={`${data.judge.status} — ${data.judge.detail}`}
              />
              <Row
                label="Last failure"
                value={
                  data.lastFailure ? (
                    <span className="text-danger">
                      {formatTime(data.lastFailure.at)} · {data.lastFailure.kind}
                      {data.lastFailure.status ? ` (HTTP ${data.lastFailure.status})` : ''} ·{' '}
                      {data.lastFailure.message}
                    </span>
                  ) : (
                    <span className="text-ink-faint">none recorded</span>
                  )
                }
              />
            </tbody>
          </table>

          {testError && <div className="mt-3 text-[12px] text-danger">{testError}</div>}

          {check && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex items-center gap-2">
                <span className={clsx('vc-tag', check.ok ? 'text-success' : 'text-danger')}>
                  {check.ok ? 'PIPELINE VERIFIED' : 'PIPELINE INCOMPLETE'}
                </span>
                <span className="text-[11px] text-ink-faint">
                  builder → reviewer round trip · {formatTime(check.startedAt)}
                </span>
              </div>
              {check.stages.length === 0 ? (
                <Empty>No stage ran.</Empty>
              ) : (
                check.stages.map((stage) => (
                  <div key={stage.name} className="mb-1.5 flex flex-wrap items-center gap-2">
                    <StatusDot status={stage.status} />
                    <span className="w-[190px] text-ink">{stage.label}</span>
                    <span className="text-ink-faint">{stage.detail}</span>
                    {stage.durationMs !== null && (
                      <span className="text-[10.5px] text-ink-faint">{formatDuration(stage.durationMs)}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="w-[150px] py-1.5 pr-3 align-top text-ink-faint">{label}</td>
      <td className="py-1.5 text-ink-dim">{value}</td>
    </tr>
  );
}
