'use client';

import { useState } from 'react';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, StatusDot } from '@/components/ui/primitives';
import { api, formatTime } from '@/lib/api';
import type { HealthStatus } from '@/core/types';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'agent' | 'key-file';
  keyPath: string | null;
  status: HealthStatus;
  lastCheckedAt: string | null;
}

/**
 * VPS: stored connection descriptors and a non-interactive reachability probe.
 * No password or key material is ever sent from the browser or stored here.
 */
export default function VpsPage() {
  const { data, error, refresh } = usePoll<{ connections: Connection[] }>('/api/vps', 0);
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    authMethod: 'agent' as 'agent' | 'key-file',
    keyPath: '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await api.post('/api/vps', {
        name: form.name,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        authMethod: form.authMethod,
        keyPath: form.authMethod === 'key-file' ? form.keyPath : null,
      });
      setForm({ name: '', host: '', port: 22, username: '', authMethod: 'agent', keyPath: '' });
      void refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const check = async (id: string): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<{ status: string; detail: string; latencyMs: number }>(`/api/vps/${id}`);
      setNotice(`${result.status} · ${result.detail} (${result.latencyMs} ms)`);
      void refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await api.del('/api/vps', { id });
    void refresh();
  };

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />

      <Panel title="Connections" className="mb-3">
        {(data?.connections.length ?? 0) === 0 ? (
          <Empty>No connection registered.</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">Auth</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Checked</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data?.connections.map((connection) => (
                <tr key={connection.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5 text-ink">{connection.name}</td>
                  <td className="px-4 py-1.5 vc-mono text-ink-dim">
                    {connection.username}@{connection.host}:{connection.port}
                  </td>
                  <td className="px-4 py-1.5 text-ink-faint">
                    {connection.authMethod === 'agent' ? 'ssh agent' : `key: ${connection.keyPath ?? '—'}`}
                  </td>
                  <td className="px-4 py-1.5">
                    <span className="vc-tag">
                      <StatusDot status={connection.status} />
                      {connection.status}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-ink-faint">{formatTime(connection.lastCheckedAt)}</td>
                  <td className="px-4 py-1.5 text-right">
                    <button
                      type="button"
                      className="vc-button py-1"
                      disabled={busy}
                      onClick={() => void check(connection.id)}
                    >
                      Check
                    </button>
                    <button
                      type="button"
                      className="vc-button vc-button-danger ml-2 py-1"
                      onClick={() => void remove(connection.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {notice && <div className="border-t border-line px-4 py-2 text-[11.5px] text-ink-dim">{notice}</div>}
      </Panel>

      <Panel title="Register connection">
        <div className="grid gap-3 px-4 py-3 md:grid-cols-3">
          <label className="text-[11.5px] text-ink-dim">
            Name
            <input
              className="vc-input mt-1"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="text-[11.5px] text-ink-dim">
            Host
            <input
              className="vc-input mt-1"
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
            />
          </label>
          <label className="text-[11.5px] text-ink-dim">
            Port
            <input
              type="number"
              className="vc-input mt-1"
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
            />
          </label>
          <label className="text-[11.5px] text-ink-dim">
            Username
            <input
              className="vc-input mt-1"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
            />
          </label>
          <label className="text-[11.5px] text-ink-dim">
            Auth method
            <select
              className="vc-input mt-1"
              value={form.authMethod}
              onChange={(event) => setForm({ ...form, authMethod: event.target.value as 'agent' | 'key-file' })}
            >
              <option value="agent">ssh agent</option>
              <option value="key-file">key file on the server</option>
            </select>
          </label>
          {form.authMethod === 'key-file' && (
            <label className="text-[11.5px] text-ink-dim">
              Key path (server side)
              <input
                className="vc-input mt-1"
                value={form.keyPath}
                placeholder="/home/user/.ssh/id_ed25519"
                onChange={(event) => setForm({ ...form, keyPath: event.target.value })}
              />
            </label>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <button
            type="button"
            className="vc-button vc-button-primary"
            disabled={busy || !form.name || !form.host || !form.username}
            onClick={() => void create()}
          >
            Register
          </button>
          <span className="text-[11px] text-ink-faint">
            Passwords are never accepted: authentication uses the server ssh agent or a key file already on the host.
          </span>
        </div>
      </Panel>
    </div>
  );
}
