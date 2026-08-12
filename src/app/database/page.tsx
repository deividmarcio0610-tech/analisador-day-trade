'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, Spinner } from '@/components/ui/primitives';

interface DatabaseResponse {
  engine: string;
  file: string;
  available: boolean;
  integrityCheck: string;
  detail?: string;
  tables: Array<{
    name: string;
    rowCount: number;
    columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean }>;
    indexes: Array<{ name: string; unique: boolean; columns: string[] }>;
    foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>;
  }>;
  findings: Array<{ severity: string; kind: string; target: string; detail: string }>;
  nPlusOne: Array<{ target: string; detail: string; file?: string; line?: number }>;
  migrations: Array<{ file: string; statements: number; hasDropStatements: boolean }>;
}

/** DATABASE DOCTOR: real schema inspection plus static N+1 detection. */
export default function DatabasePage() {
  const { data, error, loading, refresh } = usePoll<DatabaseResponse>('/api/database', 0);
  const [selected, setSelected] = useState<string | null>(null);

  const table = data?.tables.find((item) => item.name === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <ErrorNote error={error} />
      {loading && <div className="p-4"><Spinner label="inspecting database" /></div>}

      {data && !data.available && (
        <Panel title="Database">
          <Empty>
            No SQLite database opened yet ({data.detail ?? 'unavailable'}). The Vision store is created on first use.
          </Empty>
        </Panel>
      )}

      {data?.available && (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-3">
          <Panel
            title={`Tables · ${data.tables.length}`}
            actions={
              <button type="button" className="vc-button py-1" onClick={() => void refresh()}>
                Refresh
              </button>
            }
            bodyClassName="vc-scroll"
          >
            <div className="px-2 py-2">
              {data.tables.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setSelected(item.name)}
                  className={clsx(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-[12px] hover:bg-surface-hover',
                    selected === item.name && 'bg-surface-hover text-accent',
                  )}
                >
                  <span className="vc-mono truncate">{item.name}</span>
                  <span className="text-[10.5px] text-ink-faint">{item.rowCount}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-line px-3 py-2 text-[11px] text-ink-faint">
              integrity: <span className={data.integrityCheck === 'ok' ? 'text-success' : 'text-danger'}>{data.integrityCheck}</span>
              <div className="mt-1 vc-mono break-all">{data.file}</div>
            </div>
          </Panel>

          <div className="vc-scroll min-h-0 space-y-3">
            {table && (
              <Panel title={`Schema · ${table.name}`}>
                <div className="px-4 py-3">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                        <th className="py-1.5">Column</th>
                        <th className="py-1.5">Type</th>
                        <th className="py-1.5">Not null</th>
                        <th className="py-1.5">PK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.columns.map((column) => (
                        <tr key={column.name} className="border-b border-line last:border-0">
                          <td className="py-1.5 vc-mono text-ink">{column.name}</td>
                          <td className="py-1.5 text-ink-dim">{column.type || '—'}</td>
                          <td className="py-1.5 text-ink-faint">{column.notNull ? 'yes' : ''}</td>
                          <td className="py-1.5 text-accent">{column.primaryKey ? 'yes' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 text-[11.5px]">
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-dim">Indexes</div>
                      {table.indexes.length === 0 ? (
                        <div className="text-ink-faint">none</div>
                      ) : (
                        table.indexes.map((index) => (
                          <div key={index.name} className="vc-mono text-ink-dim">
                            {index.unique ? 'UNIQUE ' : ''}
                            {index.name} ({index.columns.join(', ')})
                          </div>
                        ))
                      )}
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-dim">Foreign keys</div>
                      {table.foreignKeys.length === 0 ? (
                        <div className="text-ink-faint">none</div>
                      ) : (
                        table.foreignKeys.map((fk, index) => (
                          <div key={index} className="vc-mono text-ink-dim">
                            {fk.column} → {fk.referencesTable}.{fk.referencesColumn}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            <Panel title={`Findings · ${data.findings.length}`}>
              {data.findings.length === 0 ? (
                <Empty>No schema problem detected.</Empty>
              ) : (
                <div className="px-4 py-3 text-[12px]">
                  {data.findings.map((finding, index) => (
                    <div key={index} className="mb-1.5 flex flex-wrap gap-2">
                      <span
                        className={clsx(
                          'vc-tag',
                          finding.severity === 'high' ? 'border-danger/40 text-danger' : 'border-amber/40 text-amber',
                        )}
                      >
                        {finding.kind}
                      </span>
                      <span className="vc-mono text-ink">{finding.target}</span>
                      <span className="text-ink-faint">{finding.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Possible N+1 · ${data.nPlusOne.length}`}>
              {data.nPlusOne.length === 0 ? (
                <Empty>No awaited query inside a loop was found.</Empty>
              ) : (
                <div className="px-4 py-3 text-[12px]">
                  {data.nPlusOne.map((finding, index) => (
                    <div key={index} className="mb-1 flex gap-2">
                      <span className="vc-mono text-ink-faint">
                        {finding.file}:{finding.line}
                      </span>
                      <span className="text-ink-dim">{finding.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Migration files · ${data.migrations.length}`}>
              {data.migrations.length === 0 ? (
                <Empty>No .sql migration files found in the workspace.</Empty>
              ) : (
                <div className="px-4 py-3 text-[12px]">
                  {data.migrations.map((migration) => (
                    <div key={migration.file} className="mb-1 flex gap-2">
                      <span className="vc-mono text-ink-dim">{migration.file}</span>
                      <span className="text-ink-faint">{migration.statements} statement(s)</span>
                      {migration.hasDropStatements && <span className="text-danger">contains DROP</span>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
