'use client';

import clsx from 'clsx';

/** Renders unified diff text with per-line colouring. */
export function DiffView({ patch, maxHeight = 420 }: { patch: string; maxHeight?: number }) {
  if (!patch || patch.trim().length === 0) {
    return <div className="vc-empty">No textual change.</div>;
  }

  return (
    <pre
      className="vc-scroll vc-mono m-0 leading-[1.55] whitespace-pre"
      style={{ maxHeight }}
    >
      {patch.split('\n').map((line, index) => (
        <div
          key={index}
          className={clsx(
            'px-3',
            line.startsWith('+++') || line.startsWith('---')
              ? 'text-ink-faint'
              : line.startsWith('@@')
                ? 'bg-info/10 text-info'
                : line.startsWith('+')
                  ? 'bg-success/10 text-success'
                  : line.startsWith('-')
                    ? 'bg-danger/10 text-danger'
                    : 'text-ink-dim',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
