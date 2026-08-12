'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { usePoll } from '@/components/hooks/use-poll';
import { DiffView } from '@/components/diff-view';
import { Empty, ErrorNote, Panel, Spinner } from '@/components/ui/primitives';
import { api, formatTime } from '@/lib/api';

interface GitResponse {
  status: {
    available: boolean;
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    clean: boolean;
    files: Array<{ path: string; index: string; worktree: string; staged: boolean; untracked: boolean }>;
  };
  diff: { files: Array<{ path: string; additions: number; deletions: number; patch: string }> };
  commits: Array<{ shortHash: string; author: string; date: string; subject: string }>;
  branches: Array<{ name: string; current: boolean; remote: boolean }>;
  stashes: string[];
  checkpoints: Array<{ tag: string; sha: string; createdAt: string }>;
  worktrees: Array<{ path: string; branch: string | null; head: string | null }>;
}

/** GIT: status, diff, history, branches, stashes, worktrees and Vision checkpoints. */
export default function GitPage() {
  const { data, error, loading, refresh } = usePoll<GitResponse>('/api/git', 10_000);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const checkpoint = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await api.post<{ checkpoint: { tag: string } | null }>('/api/git', {
        action: 'checkpoint',
        label: 'manual',
      });
      setNotice(
        response.checkpoint ? `Checkpoint created: ${response.checkpoint.tag}` : 'Checkpoint could not be created',
      );
      void refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <div className="p-6"><Spinner label="reading repository" /></div>;

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />

      {data && !data.status.available && (
        <Panel title="Git">
          <Empty>This workspace is not a git repository.</Empty>
        </Panel>
      )}

      {data?.status.available && (
        <>
          <Panel
            title={`Branch ${data.status.branch ?? 'detached'} · ahead ${data.status.ahead} · behind ${data.status.behind}`}
            actions={
              <button type="button" className="vc-button py-1" disabled={busy} onClick={() => void checkpoint()}>
                Create checkpoint
              </button>
            }
            className="mb-3"
          >
            <div className="px-4 py-3 text-[12px]">
              {notice && <div className="mb-2 text-[11.5px] text-accent">{notice}</div>}
              {data.status.clean ? (
                <div className="text-success">Working tree clean.</div>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {data.status.files.map((file) => (
                    <span key={file.path} className="vc-mono text-ink-dim">
                      <span className={file.untracked ? 'text-violet' : 'text-amber'}>
                        {file.index}
                        {file.worktree}
                      </span>{' '}
                      {file.path}
                    </span>
                  ))}
                </div>
              )}
              {data.status.upstream && (
                <div className="mt-2 text-[11px] text-ink-faint">upstream: {data.status.upstream}</div>
              )}
            </div>
          </Panel>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel title="Diff" bodyClassName="flex min-h-0 flex-col">
              {data.diff.files.length === 0 ? (
                <Empty>No changes to show.</Empty>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
                    {data.diff.files.map((file, index) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelected(index)}
                        className={clsx('vc-tag normal-case', index === selected && 'border-accent/50 text-accent')}
                      >
                        <span className="vc-mono">{file.path}</span>
                        <span className="text-success">+{file.additions}</span>
                        <span className="text-danger">-{file.deletions}</span>
                      </button>
                    ))}
                  </div>
                  <DiffView patch={data.diff.files[selected]?.patch ?? ''} maxHeight={460} />
                </>
              )}
            </Panel>

            <div className="space-y-3">
              <Panel title="Recent commits" bodyClassName="vc-scroll max-h-64">
                {data.commits.length === 0 ? (
                  <Empty>No commits.</Empty>
                ) : (
                  <div className="px-4 py-2 text-[12px]">
                    {data.commits.map((commit) => (
                      <div key={commit.shortHash} className="mb-1 flex gap-2">
                        <span className="vc-mono shrink-0 text-accent">{commit.shortHash}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-dim">{commit.subject}</span>
                        <span className="shrink-0 text-[10.5px] text-ink-faint">{commit.author}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Checkpoints" bodyClassName="vc-scroll max-h-52">
                {data.checkpoints.length === 0 ? (
                  <Empty>No Vision checkpoint yet. One is created before every patch apply.</Empty>
                ) : (
                  <div className="px-4 py-2 text-[11.5px]">
                    {data.checkpoints.map((point) => (
                      <div key={point.tag} className="mb-1 flex justify-between gap-2">
                        <span className="vc-mono truncate text-ink-dim">{point.tag}</span>
                        <span className="shrink-0 text-ink-faint">{formatTime(point.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Branches, stashes and worktrees" bodyClassName="vc-scroll max-h-64">
                <div className="px-4 py-2 text-[11.5px]">
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-ink-faint">Branches</div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {data.branches.map((branch) => (
                      <span
                        key={branch.name}
                        className={clsx('vc-tag normal-case', branch.current && 'border-accent/50 text-accent')}
                      >
                        {branch.name}
                      </span>
                    ))}
                  </div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-ink-faint">Stashes</div>
                  <div className="mb-2 text-ink-dim">
                    {data.stashes.length === 0 ? 'none' : data.stashes.map((stash) => <div key={stash}>{stash}</div>)}
                  </div>
                  <div className="mb-1 text-[10.5px] uppercase tracking-wide text-ink-faint">Worktrees</div>
                  <div className="text-ink-dim">
                    {data.worktrees.map((worktree) => (
                      <div key={worktree.path} className="vc-mono truncate">
                        {worktree.path} {worktree.branch ? `(${worktree.branch})` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
