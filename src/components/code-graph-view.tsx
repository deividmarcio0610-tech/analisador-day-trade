'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { usePoll } from './hooks/use-poll';
import { Empty, Panel, Spinner } from './ui/primitives';
import { api, formatBytes } from '@/lib/api';

/**
 * CODE GRAPH viewer.
 *
 * Modules are grouped by architectural layer and navigable: selecting one shows
 * what it imports, what imports it, and the impact of changing it.
 */

interface GraphNode {
  id: string;
  label: string;
  layer: string;
  sizeBytes: number;
  imports: number;
  importedBy: number;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: Array<{ from: string; to: string }>;
  externals: Array<{ name: string; count: number }>;
  cycles: string[][];
  builtAt: string;
  truncated: boolean;
}

interface ImpactResponse {
  directDependents: string[];
  transitiveDependents: string[];
  affectedApiRoutes: string[];
  affectedDatabaseModules: string[];
  relatedTests: string[];
}

const LAYERS = ['component', 'api', 'service', 'database', 'worker', 'test', 'config', 'other'] as const;

const LAYER_COLOR: Record<string, string> = {
  component: 'text-violet',
  api: 'text-accent',
  service: 'text-info',
  database: 'text-amber',
  worker: 'text-success',
  test: 'text-ink-faint',
  config: 'text-ink-faint',
  other: 'text-ink-dim',
};

export function CodeGraphView() {
  const { data, loading, error, refresh } = usePoll<GraphResponse>('/api/graph', 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [impact, setImpact] = useState<ImpactResponse | null>(null);

  const byLayer = useMemo(() => {
    const groups = new Map<string, GraphNode[]>();
    for (const node of data?.nodes ?? []) {
      if (filter && !node.id.toLowerCase().includes(filter.toLowerCase())) continue;
      const list = groups.get(node.layer) ?? [];
      list.push(node);
      groups.set(node.layer, list);
    }
    return groups;
  }, [data, filter]);

  const select = async (id: string): Promise<void> => {
    setSelected(id);
    setImpact(null);
    try {
      setImpact(await api.post<ImpactResponse>('/api/impact', { files: [id] }));
    } catch {
      setImpact(null);
    }
  };

  const dependencies = (data?.edges ?? []).filter((edge) => edge.from === selected).map((edge) => edge.to);
  const dependents = (data?.edges ?? []).filter((edge) => edge.to === selected).map((edge) => edge.from);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
      <Panel
        title={
          data
            ? `Modules · ${data.nodes.length} node(s), ${data.edges.length} edge(s)${data.truncated ? ' (truncated)' : ''}`
            : 'Modules'
        }
        actions={
          <>
            <input
              className="vc-input h-[26px] w-40 py-0 text-[11.5px]"
              placeholder="filter path"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <button type="button" className="vc-button py-1" onClick={() => void refresh()}>
              Rebuild
            </button>
          </>
        }
        bodyClassName="vc-scroll"
      >
        {loading && <div className="p-4"><Spinner label="building graph" /></div>}
        {error && <div className="px-4 py-3 text-[12px] text-danger">{error}</div>}
        {data && data.nodes.length === 0 && <Empty>No source modules found.</Empty>}

        <div className="px-2 py-2">
          {LAYERS.map((layer) => {
            const nodes = byLayer.get(layer);
            if (!nodes || nodes.length === 0) return null;
            return (
              <div key={layer} className="mb-3">
                <div className={clsx('px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider', LAYER_COLOR[layer])}>
                  {layer} · {nodes.length}
                </div>
                {nodes.slice(0, 120).map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => void select(node.id)}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11.5px] hover:bg-surface-hover',
                      selected === node.id && 'bg-surface-hover text-accent',
                    )}
                  >
                    <span className="vc-mono min-w-0 flex-1 truncate">{node.id}</span>
                    <span className="shrink-0 text-[10px] text-ink-faint">
                      ↓{node.imports} ↑{node.importedBy} · {formatBytes(node.sizeBytes)}
                    </span>
                  </button>
                ))}
                {nodes.length > 120 && (
                  <div className="px-2 py-1 text-[10.5px] text-ink-faint">
                    {nodes.length - 120} more not listed — narrow the filter
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid min-h-0 grid-rows-2 gap-3">
        <Panel title={selected ? `Module · ${selected}` : 'Module'} bodyClassName="vc-scroll">
          {!selected ? (
            <Empty>Select a module to inspect its edges.</Empty>
          ) : (
            <div className="px-4 py-3 text-[12px]">
              <Section title={`Imports (${dependencies.length})`} items={dependencies} onSelect={select} />
              <Section title={`Imported by (${dependents.length})`} items={dependents} onSelect={select} />
              {impact && (
                <>
                  <Section
                    title={`Blast radius (${impact.transitiveDependents.length})`}
                    items={impact.transitiveDependents}
                    onSelect={select}
                  />
                  <Section title={`Related tests (${impact.relatedTests.length})`} items={impact.relatedTests} onSelect={select} />
                  <Section title={`API routes affected (${impact.affectedApiRoutes.length})`} items={impact.affectedApiRoutes} onSelect={select} />
                </>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Cycles and externals" bodyClassName="vc-scroll">
          <div className="px-4 py-3 text-[12px]">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Circular imports
            </div>
            {(data?.cycles.length ?? 0) === 0 ? (
              <div className="mb-3 text-[11.5px] text-success">none detected</div>
            ) : (
              data?.cycles.map((cycle, index) => (
                <div key={index} className="mb-1 vc-mono text-[11px] text-danger">
                  {cycle.join(' → ')}
                </div>
              ))
            )}

            <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              External packages
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(data?.externals ?? []).slice(0, 40).map((external) => (
                <span key={external.name} className="vc-tag normal-case">
                  {external.name} <span className="text-ink-faint">{external.count}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: string[];
  onSelect: (id: string) => Promise<void>;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">{title}</div>
      {items.length === 0 ? (
        <div className="text-[11.5px] text-ink-faint">none</div>
      ) : (
        items.slice(0, 40).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => void onSelect(item)}
            className="block w-full truncate rounded px-1 py-0.5 text-left vc-mono text-[11px] text-ink-dim hover:bg-surface-hover hover:text-accent"
          >
            {item}
          </button>
        ))
      )}
    </div>
  );
}
