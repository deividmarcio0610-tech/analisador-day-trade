import { getDb, asNumber, asText, asTextOrNull } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import { runCommand } from './process-runner';
import type { HealthStatus } from '@/core/types';

/**
 * VPS CONNECTIONS
 *
 * Stores connection descriptors only — host, port, user, auth method and an
 * optional key path. Passwords and keys are never stored, never sent to the
 * browser, and the reachability check runs with BatchMode so nothing can prompt
 * for a credential.
 */

export type AuthMethod = 'agent' | 'key-file';

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath: string | null;
  status: HealthStatus;
  lastCheckedAt: string | null;
  createdAt: string;
}

export function listConnections(): Connection[] {
  return getDb()
    .prepare('SELECT * FROM connections ORDER BY created_at DESC')
    .all()
    .map(toConnection);
}

export function getConnection(id: string): Connection | null {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
  return row ? toConnection(row) : null;
}

export function createConnection(input: {
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: AuthMethod;
  keyPath?: string | null;
}): Connection {
  const connection: Connection = {
    id: newId('conn'),
    name: input.name,
    host: input.host,
    port: input.port ?? 22,
    username: input.username,
    authMethod: input.authMethod,
    keyPath: input.keyPath ?? null,
    status: 'UNKNOWN',
    lastCheckedAt: null,
    createdAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, host, port, username, auth_method, key_path, status, last_checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      connection.id,
      connection.name,
      connection.host,
      connection.port,
      connection.username,
      connection.authMethod,
      connection.keyPath,
      connection.status,
      connection.lastCheckedAt,
      connection.createdAt,
    );
  return connection;
}

export function deleteConnection(id: string): void {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(id);
}

export interface ConnectionCheck {
  id: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number;
}

/** Non-interactive reachability probe. Never supplies a password. */
export async function checkConnection(id: string): Promise<ConnectionCheck> {
  const connection = getConnection(id);
  if (!connection) throw new Error(`Connection not found: ${id}`);

  const identity = connection.authMethod === 'key-file' && connection.keyPath
    ? `-i "${connection.keyPath}" `
    : '';
  const command =
    `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 ` +
    `${identity}-p ${connection.port} ${connection.username}@${connection.host} "echo vision-ok"`;

  const startedAt = Date.now();
  const result = await runCommand({ commandLine: command, timeoutMs: 20_000, confirmed: true }).catch(
    (error: unknown) => ({
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: null as number | null,
    }),
  );

  const ok = result.exitCode === 0 && result.stdout.includes('vision-ok');
  const status: HealthStatus = ok ? 'ONLINE' : result.exitCode === null ? 'UNKNOWN' : 'OFFLINE';
  const detail = ok ? 'ssh reachable' : (result.stderr.trim().split('\n')[0] ?? 'unreachable');

  getDb()
    .prepare('UPDATE connections SET status = ?, last_checked_at = ? WHERE id = ?')
    .run(status, nowIso(), id);

  return { id, status, detail, latencyMs: Date.now() - startedAt };
}

function toConnection(row: Record<string, unknown>): Connection {
  return {
    id: asText(row.id),
    name: asText(row.name),
    host: asText(row.host),
    port: asNumber(row.port),
    username: asText(row.username),
    authMethod: asText(row.auth_method) as AuthMethod,
    keyPath: asTextOrNull(row.key_path),
    status: asText(row.status) as HealthStatus,
    lastCheckedAt: asTextOrNull(row.last_checked_at),
    createdAt: asText(row.created_at),
  };
}
