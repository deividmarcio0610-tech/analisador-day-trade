'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { Empty, Spinner } from './ui/primitives';
import type { FileNodeView } from '@/lib/types';

/** Lazy directory tree over the workspace. Heavy folders are skipped server side. */

interface TreeState {
  [path: string]: FileNodeView[] | undefined;
}

export function FileExplorer({
  onOpen,
  activePath,
  changedPaths = [],
}: {
  onOpen: (path: string) => void;
  activePath?: string | null;
  changedPaths?: string[];
}) {
  const [tree, setTree] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (path: string): Promise<void> => {
    try {
      const response = await api.get<{ entries: FileNodeView[] }>(
        `/api/fs/tree?path=${encodeURIComponent(path)}`,
      );
      setTree((previous) => ({ ...previous, [path]: response.entries }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('.');
  }, [load]);

  const toggle = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!tree[path]) void load(path);
      }
      return next;
    });
  };

  const render = (path: string, depth: number): React.ReactNode => {
    const entries = tree[path];
    if (!entries) return null;
    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const changed = changedPaths.includes(entry.path);
      return (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() => (entry.type === 'directory' ? toggle(entry.path) : onOpen(entry.path))}
            className={clsx(
              'flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-[12px] hover:bg-surface-hover',
              activePath === entry.path && 'bg-surface-hover text-accent',
              changed && 'text-amber',
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {entry.type === 'directory' ? (
              <>
                {isOpen ? <ChevronDown size={12} className="shrink-0 text-ink-faint" /> : <ChevronRight size={12} className="shrink-0 text-ink-faint" />}
                {isOpen ? <FolderOpen size={13} className="shrink-0 text-violet" /> : <Folder size={13} className="shrink-0 text-violet" />}
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                <FileIcon size={13} className="shrink-0 text-ink-faint" />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.type === 'directory' && isOpen && render(entry.path, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="vc-panel-header shrink-0">
        <span>Explorer</span>
        <button
          type="button"
          className="text-ink-faint hover:text-ink"
          onClick={() => {
            setTree({});
            setLoading(true);
            void load('.');
            for (const path of expanded) if (path !== '.') void load(path);
          }}
          aria-label="Refresh tree"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="vc-scroll min-h-0 flex-1 px-1 py-1.5">
        {loading && <div className="px-3 py-2"><Spinner label="reading workspace" /></div>}
        {error && <div className="px-3 py-2 text-[11.5px] text-danger">{error}</div>}
        {!loading && !error && (tree['.']?.length ?? 0) === 0 && <Empty>Empty workspace.</Empty>}
        {render('.', 0)}
      </div>
    </div>
  );
}
