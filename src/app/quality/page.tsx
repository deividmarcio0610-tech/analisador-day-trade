'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, Spinner } from '@/components/ui/primitives';

/**
 * QUALITY: technical debt, defensive security review and API contract guard.
 * Everything here is static analysis over the real files, with paths and lines.
 */

interface QualityResponse {
  debt: {
    markers: Array<{ path: string; line: number; kind: string; text: string }>;
    largeFiles: Array<{ path: string; lines: number }>;
    complexFunctions: Array<{ path: string; line: number; name: string; branches: number }>;
    circularImports: string[][];
    orphanModules: string[];
    scannedFiles: number;
  };
  security: {
    findings: Array<{
      severity: 'high' | 'medium' | 'low';
      category: string;
      path: string;
      line: number;
      summary: string;
      detail: string;
    }>;
    scannedFiles: number;
  };
  contract: {
    routes: Array<{ endpoint: string; file: string; methods: string[] }>;
    calls: Array<{ endpoint: string; file: string; line: number; method: string }>;
    issues: Array<{ kind: string; endpoint: string; detail: string; file?: string; line?: number }>;
  };
}

const TABS = ['debt', 'security', 'contract'] as const;

export default function QualityPage() {
  const { data, error, loading, refresh } = usePoll<QualityResponse>('/api/quality?scope=all', 0);
  const [tab, setTab] = useState<(typeof TABS)[number]>('debt');

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
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
        <button type="button" className="vc-button ml-auto py-1" onClick={() => void refresh()}>
          Rescan
        </button>
      </div>

      <ErrorNote error={error} />
      {loading && <div className="p-4"><Spinner label="analysing workspace" /></div>}

      {data && tab === 'debt' && (
        <div className="vc-scroll min-h-0 flex-1 space-y-3">
          <Panel title={`Markers · ${data.debt.markers.length}`} bodyClassName="vc-scroll max-h-72">
            {data.debt.markers.length === 0 ? (
              <Empty>No TODO/FIXME/HACK markers in {data.debt.scannedFiles} scanned file(s).</Empty>
            ) : (
              <div className="px-4 py-2 text-[12px]">
                {data.debt.markers.map((marker, index) => (
                  <div key={index} className="mb-0.5 flex gap-2">
                    <span className={marker.kind === 'FIXME' ? 'text-danger' : 'text-amber'}>{marker.kind}</span>
                    <span className="vc-mono text-ink-faint">
                      {marker.path}:{marker.line}
                    </span>
                    <span className="text-ink-dim">{marker.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title={`Circular imports · ${data.debt.circularImports.length}`} bodyClassName="vc-scroll max-h-64">
              {data.debt.circularImports.length === 0 ? (
                <Empty>None.</Empty>
              ) : (
                <div className="px-4 py-2 vc-mono text-[11px] text-danger">
                  {data.debt.circularImports.map((cycle, index) => (
                    <div key={index} className="mb-1">{cycle.join(' → ')}</div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Large files · ${data.debt.largeFiles.length}`} bodyClassName="vc-scroll max-h-64">
              {data.debt.largeFiles.length === 0 ? (
                <Empty>No file over 500 lines.</Empty>
              ) : (
                <div className="px-4 py-2 text-[11.5px]">
                  {data.debt.largeFiles.map((file) => (
                    <div key={file.path} className="mb-0.5 flex justify-between gap-2">
                      <span className="vc-mono truncate text-ink-dim">{file.path}</span>
                      <span className="shrink-0 text-ink-faint">{file.lines} lines</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title={`High branch count · ${data.debt.complexFunctions.length}`}
              bodyClassName="vc-scroll max-h-64"
            >
              {data.debt.complexFunctions.length === 0 ? (
                <Empty>No function above the branch threshold.</Empty>
              ) : (
                <div className="px-4 py-2 text-[11.5px]">
                  <div className="mb-1 text-[10.5px] text-ink-faint">
                    Branch-count estimate, not AST cyclomatic complexity.
                  </div>
                  {data.debt.complexFunctions.map((fn, index) => (
                    <div key={index} className="mb-0.5 flex justify-between gap-2">
                      <span className="vc-mono truncate text-ink-dim">
                        {fn.name} · {fn.path}:{fn.line}
                      </span>
                      <span className="shrink-0 text-amber">{fn.branches}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {data && tab === 'security' && (
        <Panel
          title={`Defensive review · ${data.security.findings.length} finding(s) in ${data.security.scannedFiles} file(s)`}
          className="min-h-0 flex-1"
          bodyClassName="vc-scroll"
        >
          {data.security.findings.length === 0 ? (
            <Empty>No pattern matched. This is a heuristic scan, not a guarantee.</Empty>
          ) : (
            <div className="px-4 py-3">
              {data.security.findings.map((finding, index) => (
                <div key={index} className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        'vc-tag',
                        finding.severity === 'high'
                          ? 'border-danger/40 text-danger'
                          : finding.severity === 'medium'
                            ? 'border-amber/40 text-amber'
                            : 'border-line-strong text-ink-faint',
                      )}
                    >
                      {finding.severity}
                    </span>
                    <span className="vc-tag">{finding.category}</span>
                    <span className="vc-mono text-[11px] text-ink-faint">
                      {finding.path}:{finding.line}
                    </span>
                  </div>
                  <div className="text-[12.5px] text-ink">{finding.summary}</div>
                  <p className="mt-0.5 text-[11.5px] text-ink-dim">{finding.detail}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {data && tab === 'contract' && (
        <div className="vc-scroll min-h-0 flex-1 space-y-3">
          <Panel title={`Contract issues · ${data.contract.issues.length}`} bodyClassName="vc-scroll max-h-72">
            {data.contract.issues.length === 0 ? (
              <Empty>Frontend calls and backend routes agree.</Empty>
            ) : (
              <div className="px-4 py-2 text-[12px]">
                {data.contract.issues.map((issue, index) => (
                  <div key={index} className="mb-1 flex flex-wrap gap-2">
                    <span
                      className={clsx(
                        'vc-tag',
                        issue.kind === 'missing-route'
                          ? 'border-danger/40 text-danger'
                          : issue.kind === 'method-not-exported'
                            ? 'border-amber/40 text-amber'
                            : 'border-line-strong text-ink-faint',
                      )}
                    >
                      {issue.kind}
                    </span>
                    <span className="vc-mono text-ink">{issue.endpoint}</span>
                    <span className="text-ink-faint">{issue.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title={`Routes · ${data.contract.routes.length}`} bodyClassName="vc-scroll max-h-80">
              <div className="px-4 py-2 text-[11.5px]">
                {data.contract.routes.map((route) => (
                  <div key={route.file} className="mb-0.5 flex justify-between gap-2">
                    <span className="vc-mono truncate text-ink-dim">{route.endpoint}</span>
                    <span className="shrink-0 text-ink-faint">{route.methods.join(' ') || 'no method exported'}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={`Client calls · ${data.contract.calls.length}`} bodyClassName="vc-scroll max-h-80">
              <div className="px-4 py-2 text-[11.5px]">
                {data.contract.calls.map((call, index) => (
                  <div key={index} className="mb-0.5 flex justify-between gap-2">
                    <span className="vc-mono truncate text-ink-dim">
                      {call.method} {call.endpoint}
                    </span>
                    <span className="shrink-0 text-ink-faint">
                      {call.file}:{call.line}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
