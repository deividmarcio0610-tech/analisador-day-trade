import { getDb, asText } from '@/core/db/database';
import { nowIso } from '@/core/util/id';

/** Key/value settings store. Values are JSON encoded. */

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(asText(row.value)) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso());
}

export function allSettings(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[asText(row.key)] = JSON.parse(asText(row.value));
    } catch {
      out[asText(row.key)] = null;
    }
  }
  return out;
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}
