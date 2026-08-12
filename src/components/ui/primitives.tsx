'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { HealthStatus, Verdict } from '@/core/types';

/** Small presentational building blocks shared by every screen. */

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('vc-panel flex min-h-0 flex-col', className)}>
      {title !== undefined && (
        <header className="vc-panel-header shrink-0">
          <span className="truncate">{title}</span>
          {actions && <span className="flex items-center gap-2">{actions}</span>}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

const HEALTH_COLOR: Record<HealthStatus, string> = {
  ONLINE: 'text-success',
  OFFLINE: 'text-danger',
  // Reachable but wrong: distinct from unreachable, because the fix is different.
  ERROR: 'text-violet',
  UNKNOWN: 'text-ink-faint',
  NOT_CONFIGURED: 'text-amber',
};

export function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <span
      className={clsx('text-[9px] leading-none', HEALTH_COLOR[status])}
      title={status}
      aria-label={status}
    >
      ●
    </span>
  );
}

export function StatusPill({
  label,
  status,
  detail,
}: {
  label: string;
  status: HealthStatus;
  detail?: string;
}) {
  return (
    <span className="vc-tag" title={detail}>
      <StatusDot status={status} />
      {label}
      <span className="text-ink-faint normal-case">{status === 'ONLINE' ? '' : status.toLowerCase()}</span>
    </span>
  );
}

const VERDICT_STYLE: Record<Verdict, string> = {
  PASS: 'border-success/40 text-success',
  FAIL: 'border-danger/40 text-danger',
  NOT_RUN: 'border-line-strong text-ink-faint',
  BLOCKED: 'border-amber/40 text-amber',
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={clsx('vc-tag', VERDICT_STYLE[verdict])}>{verdict.replace('_', ' ')}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="vc-empty">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="m-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
      {error}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-faint">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </span>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-[12px]">
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-ink-faint">{key}</dt>
          <dd className="min-w-0 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-dim">
      {children}
    </h3>
  );
}
