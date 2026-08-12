import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { walkFiles } from '@/core/tools/filesystem';
import { databaseFile, workspaceRoot } from '@/core/paths';

/**
 * DATABASE DOCTOR
 *
 * Inspects real SQLite files (schema, indexes, foreign keys, row counts) and
 * statically reviews SQL/migration sources for common integrity problems.
 * Engines other than SQLite are reported as NOT CONFIGURED rather than guessed.
 */

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  indexes: Array<{ name: string; unique: boolean; columns: string[] }>;
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>;
  rowCount: number;
}

export interface DatabaseFinding {
  severity: 'high' | 'medium' | 'low';
  kind: 'missing-index' | 'missing-primary-key' | 'orphan-rows' | 'n-plus-one' | 'schema';
  target: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface DatabaseReport {
  engine: 'sqlite';
  file: string;
  available: boolean;
  tables: TableInfo[];
  findings: DatabaseFinding[];
  integrityCheck: string;
  detail?: string;
}

export function inspectSqlite(file = databaseFile()): DatabaseReport {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    return {
      engine: 'sqlite',
      file,
      available: false,
      tables: [],
      findings: [],
      integrityCheck: 'not run',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();

    const tables: TableInfo[] = [];
    const findings: DatabaseFinding[] = [];

    for (const row of tableRows) {
      const name = String(row.name);
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((column) => ({
        name: String(column.name),
        type: String(column.type),
        notNull: Number(column.notnull) === 1,
        primaryKey: Number(column.pk) > 0,
        defaultValue: column.dflt_value === null || column.dflt_value === undefined ? null : String(column.dflt_value),
      }));

      const indexRows = db.prepare(`PRAGMA index_list("${name}")`).all();
      const indexes = indexRows.map((index) => {
        const indexName = String(index.name);
        const indexColumns = db
          .prepare(`PRAGMA index_info("${indexName}")`)
          .all()
          .map((column) => String(column.name));
        return { name: indexName, unique: Number(index.unique) === 1, columns: indexColumns };
      });

      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list("${name}")`)
        .all()
        .map((fk) => ({
          column: String(fk.from),
          referencesTable: String(fk.table),
          referencesColumn: String(fk.to ?? 'rowid'),
        }));

      const countRow = db.prepare(`SELECT COUNT(*) AS total FROM "${name}"`).get();
      const rowCount = Number(countRow?.total ?? 0);

      tables.push({ name, columns, indexes, foreignKeys, rowCount });

      if (!columns.some((column) => column.primaryKey)) {
        findings.push({
          severity: 'medium',
          kind: 'missing-primary-key',
          target: name,
          detail: 'table has no primary key; row identity and replication both suffer',
        });
      }

      for (const fk of foreignKeys) {
        const indexed = indexes.some((index) => index.columns[0] === fk.column);
        if (!indexed) {
          findings.push({
            severity: 'medium',
            kind: 'missing-index',
            target: `${name}.${fk.column}`,
            detail: `foreign key to ${fk.referencesTable}.${fk.referencesColumn} is not indexed; joins and cascades scan the table`,
          });
        }
        const orphans = db
          .prepare(
            `SELECT COUNT(*) AS total FROM "${name}" child
             WHERE child."${fk.column}" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "${fk.referencesTable}" parent WHERE parent."${fk.referencesColumn}" = child."${fk.column}")`,
          )
          .get();
        const orphanCount = Number(orphans?.total ?? 0);
        if (orphanCount > 0) {
          findings.push({
            severity: 'high',
            kind: 'orphan-rows',
            target: `${name}.${fk.column}`,
            detail: `${orphanCount} row(s) reference a missing ${fk.referencesTable} record`,
          });
        }
      }
    }

    const integrity = db.prepare('PRAGMA integrity_check').get();
    return {
      engine: 'sqlite',
      file,
      available: true,
      tables,
      findings,
      integrityCheck: String(integrity?.integrity_check ?? 'unknown'),
    };
  } finally {
    db.close();
  }
}

const QUERY_IN_LOOP =
  /\b(for|while|forEach|map)\b[\s\S]{0,200}?\bawait\b[\s\S]{0,80}?\b(query|execute|findMany|findOne|select|get|all|run)\s*\(/;

/** Code-level N+1 detection: an awaited query inside a loop body. */
export async function detectNPlusOne(root = workspaceRoot()): Promise<DatabaseFinding[]> {
  const files = await walkFiles('.', { root, extensions: ['.ts', '.tsx', '.js'], maxFiles: 3_000 });
  const findings: DatabaseFinding[] = [];

  for (const relative of files) {
    let content: string;
    try {
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const window = lines.slice(index, index + 8).join('\n');
      if (!QUERY_IN_LOOP.test(window)) continue;
      findings.push({
        severity: 'medium',
        kind: 'n-plus-one',
        target: relative,
        detail: 'awaited query inside a loop — consider a single batched query',
        file: relative,
        line: index + 1,
      });
      index += 8;
    }
  }
  return findings;
}

export interface MigrationInfo {
  file: string;
  statements: number;
  hasDropStatements: boolean;
}

export async function listMigrationFiles(root = workspaceRoot()): Promise<MigrationInfo[]> {
  const files = await walkFiles('.', { root, extensions: ['.sql'], maxFiles: 500 });
  const migrations: MigrationInfo[] = [];
  for (const relative of files) {
    if (!/migrat/i.test(relative)) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    migrations.push({
      file: relative,
      statements: content.split(';').filter((statement) => statement.trim().length > 0).length,
      hasDropStatements: /\bdrop\s+(table|column|index)\b/i.test(content),
    });
  }
  return migrations;
}

export async function fullDatabaseReport(): Promise<DatabaseReport & { nPlusOne: DatabaseFinding[]; migrations: MigrationInfo[] }> {
  const report = inspectSqlite();
  const nPlusOne = await detectNPlusOne();
  const migrations = await listMigrationFiles();
  return { ...report, nPlusOne, migrations };
}
