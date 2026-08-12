import { DatabaseSync } from 'node:sqlite';
import { databaseFile } from '@/core/paths';
import { MIGRATIONS } from './schema';

/**
 * Single SQLite connection for the process.
 *
 * `node:sqlite` is used instead of a native addon so the platform installs with
 * plain `npm install` on any machine running Node >= 22.13.
 */

let connection: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (connection) return connection;
  const db = new DatabaseSync(databaseFile());
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  connection = db;
  return db;
}

export function closeDb(): void {
  if (connection) {
    connection.close();
    connection = null;
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map((row) => Number(row.version)));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`,
      );
    }
  }
}

/** Column values as returned by node:sqlite. */
export type SqlRow = Record<string, unknown>;

export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function asTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value);
}

export function asBoolean(value: unknown): boolean {
  return asNumber(value) !== 0;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  const text = asTextOrNull(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
