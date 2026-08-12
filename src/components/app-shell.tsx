'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  Activity, Boxes, Bug, Cpu, Database, FlaskConical, GitBranch, Gauge, Layers,
  LayoutDashboard, Rocket, Search, Server, Settings, ShieldCheck, TerminalSquare, TestTube2, Brain,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { usePoll } from '@/components/hooks/use-poll';
import { StatusDot } from '@/components/ui/primitives';
import type { SystemStatus } from '@/lib/types';
import type { HealthStatus } from '@/core/types';

/** Sidebar + header frame used by every screen. */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Work',
    items: [
      { href: '/', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
      { href: '/workspace', label: 'Workspace', icon: <TerminalSquare size={15} /> },
      { href: '/council', label: 'AI Council', icon: <Layers size={15} /> },
      { href: '/architect', label: 'Architect', icon: <Boxes size={15} /> },
      { href: '/debug', label: 'Debug', icon: <Bug size={15} /> },
    ],
  },
  {
    group: 'Evidence',
    items: [
      { href: '/tests', label: 'Tests', icon: <TestTube2 size={15} /> },
      { href: '/quality', label: 'Quality', icon: <ShieldCheck size={15} /> },
      { href: '/performance', label: 'Performance', icon: <Gauge size={15} /> },
      { href: '/database', label: 'Database', icon: <Database size={15} /> },
      { href: '/git', label: 'Git', icon: <GitBranch size={15} /> },
    ],
  },
  {
    group: 'Infrastructure',
    items: [
      { href: '/deploy', label: 'Deploy', icon: <Rocket size={15} /> },
      { href: '/vps', label: 'VPS', icon: <Server size={15} /> },
      { href: '/gpu', label: 'GPU', icon: <Cpu size={15} /> },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { href: '/memory', label: 'Memory', icon: <Brain size={15} /> },
      { href: '/research', label: 'Research', icon: <Search size={15} /> },
      { href: '/lab', label: 'Lab', icon: <FlaskConical size={15} /> },
      { href: '/settings', label: 'Settings', icon: <Settings size={15} /> },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data } = usePoll<SystemStatus>('/api/system', 15_000);

  // Role status comes from the AI health probe, not from configuration.
  const builder = data?.ai.roles.find((role) => role.role === 'builder');
  const reviewer = data?.ai.roles.find((role) => role.role === 'reviewer');

  return (
    <div className="flex h-screen w-full overflow-hidden bg-void">
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-violet text-[13px] font-bold text-void">
            V
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight">VISION CODE</div>
            <div className="truncate text-[10px] text-ink-faint">{data?.project.name ?? 'workspace'}</div>
          </div>
        </div>

        <nav className="vc-scroll flex-1 px-2 pb-4">
          {NAV.map((section) => (
            <div key={section.group} className="mb-3">
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                {section.group}
              </div>
              {section.items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      'mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[12.5px] transition-colors',
                      active
                        ? 'bg-surface-hover text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
                        : 'text-ink-dim hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    <span className={active ? 'text-accent' : 'text-ink-faint'}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Activity size={14} className="shrink-0 text-accent" />
            <span className="truncate vc-mono text-[11.5px] text-ink-dim">{data?.workspaceRoot ?? '—'}</span>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            <HeaderStat
              label={builder?.model ? `BUILDER · ${builder.model}` : 'BUILDER'}
              status={builder?.status ?? 'UNKNOWN'}
              title={builder?.detail}
            />
            <HeaderStat
              label={reviewer?.model ? `REVIEWER · ${reviewer.model}` : 'REVIEWER'}
              status={reviewer?.status ?? 'UNKNOWN'}
              title={reviewer?.detail}
            />
            <Link
              href="/gpu"
              className="flex items-center gap-1.5 text-ink-dim hover:text-ink"
              title={data?.ai.server.detail}
            >
              <StatusDot status={data?.ai.server.status ?? 'UNKNOWN'} />
              GPU
            </Link>
            <Link href="/vps" className="flex items-center gap-1.5 text-ink-dim hover:text-ink">
              <StatusDot status="UNKNOWN" />
              VPS
            </Link>
            <span className="vc-tag">
              {data?.git.available ? (data.git.branch ?? 'detached') : 'no git'}
              {data?.git.available && !data.git.clean ? ` · ${data.git.files.length}Δ` : ''}
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function HeaderStat({
  label,
  status,
  title,
}: {
  label: string;
  status: HealthStatus;
  title?: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-ink-dim" title={title ? `${status} — ${title}` : status}>
      <StatusDot status={status} />
      <span className="max-w-[190px] truncate vc-mono text-[11px]">{label}</span>
    </span>
  );
}
