import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDb, asNumber, asText, parseJson } from '@/core/db/database';
import { walkFiles, isProbablyBinary } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';
import { nowIso } from '@/core/util/id';
import { logger } from '@/core/logging/logger';

/**
 * REPOSITORY INDEX
 *
 * Incremental: a file is re-parsed only when its content hash changes, so a
 * second pass over an unchanged repository costs one stat and one read per file
 * and no parsing at all. The index is what lets the context engine and the test
 * selector answer questions about symbols without re-reading the world.
 *
 * Symbol extraction is a lexical pass, not a type checker. It is labelled as
 * such everywhere it surfaces: it finds declarations, not meanings.
 */

export interface IndexedFile {
  path: string;
  hash: string;
  sizeBytes: number;
  modifiedAt: string;
  language: string;
  /** Exported/declared names found in the file. */
  symbols: string[];
  /** Raw import specifiers, unresolved. */
  imports: string[];
  indexedAt: string;
}

export interface IndexStats {
  scanned: number;
  indexed: number;
  unchanged: number;
  removed: number;
  durationMs: number;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.cs'];
const MAX_FILE_BYTES = 1_500_000;

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

function languageFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.cs': 'csharp',
  };
  return map[extension] ?? 'other';
}

const DECLARATION_PATTERNS: RegExp[] = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+\{([^}]*)\}/g,
  /\b(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bdef\s+([A-Za-z_][\w]*)/g,
  /\bfunc\s+([A-Za-z_][\w]*)/g,
  /\bfn\s+([A-Za-z_][\w]*)/g,
];

const IMPORT_PATTERNS: RegExp[] = [
  /import\s[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s[^'"]*from\s*['"]([^'"]+)['"]/g,
  /^\s*from\s+([\w.]+)\s+import\b/gm,
];

/** Lexical symbol extraction. Declarations only — this is not type analysis. */
export function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  for (const pattern of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match !== null) {
      const captured = match[1] ?? '';
      // `export { a, b as c }` yields a list; take the exported names.
      for (const piece of captured.split(',')) {
        const name = piece.split(/\bas\b/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name);
      }
      match = pattern.exec(content);
    }
  }
  return [...symbols].sort();
}

export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match !== null) {
      if (match[1]) imports.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return [...imports].sort();
}

function readIndex(): Map<string, IndexedFile> {
  const rows = getDb().prepare('SELECT * FROM file_index').all();
  const map = new Map<string, IndexedFile>();
  for (const row of rows) {
    map.set(asText(row.path), {
      path: asText(row.path),
      hash: asText(row.hash),
      sizeBytes: asNumber(row.size_bytes),
      modifiedAt: asText(row.modified_at),
      language: asText(row.language),
      symbols: parseJson<string[]>(row.symbols, []),
      imports: parseJson<string[]>(row.imports, []),
      indexedAt: asText(row.indexed_at),
    });
  }
  return map;
}

/**
 * Bring the index up to date. Returns what actually changed, which is also the
 * signal the model cache uses to decide what to invalidate.
 */
export async function refreshIndex(options: { root?: string } = {}): Promise<IndexStats & { changed: string[] }> {
  const root = options.root ?? workspaceRoot();
  const startedAt = Date.now();
  const db = getDb();
  const existing = readIndex();
  const seen = new Set<string>();
  const changed: string[] = [];

  let indexed = 0;
  let unchanged = 0;

  const files = await walkFiles('.', { root, extensions: SOURCE_EXTENSIONS, maxFiles: 20_000 });

  const upsert = db.prepare(
    `INSERT INTO file_index (path, hash, size_bytes, modified_at, language, symbols, imports, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       hash = excluded.hash, size_bytes = excluded.size_bytes, modified_at = excluded.modified_at,
       language = excluded.language, symbols = excluded.symbols, imports = excluded.imports,
       indexed_at = excluded.indexed_at`,
  );

  for (const relative of files) {
    if (isProbablyBinary(relative)) continue;
    seen.add(relative);

    let stats;
    try {
      stats = await fs.stat(path.join(root, relative));
    } catch {
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) continue;

    const previous = existing.get(relative);
    const modifiedAt = stats.mtime.toISOString();
    // Cheap gate first: same size and mtime means the read can be skipped.
    if (previous && previous.sizeBytes === stats.size && previous.modifiedAt === modifiedAt) {
      unchanged += 1;
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    const hash = hashContent(content);
    if (previous && previous.hash === hash) {
      // Touched but identical: refresh the stat gate without re-parsing.
      db.prepare('UPDATE file_index SET modified_at = ?, indexed_at = ? WHERE path = ?').run(
        modifiedAt,
        nowIso(),
        relative,
      );
      unchanged += 1;
      continue;
    }

    upsert.run(
      relative,
      hash,
      stats.size,
      modifiedAt,
      languageFor(relative),
      JSON.stringify(extractSymbols(content)),
      JSON.stringify(extractImports(content)),
      nowIso(),
    );
    indexed += 1;
    changed.push(relative);
  }

  let removed = 0;
  for (const indexedPath of existing.keys()) {
    if (seen.has(indexedPath)) continue;
    db.prepare('DELETE FROM file_index WHERE path = ?').run(indexedPath);
    changed.push(indexedPath);
    removed += 1;
  }

  const stats: IndexStats & { changed: string[] } = {
    scanned: files.length,
    indexed,
    unchanged,
    removed,
    durationMs: Date.now() - startedAt,
    changed,
  };
  logger.debug('repo-index', `indexed ${indexed}, unchanged ${unchanged}, removed ${removed}`, {
    data: { durationMs: stats.durationMs },
  });
  return stats;
}

export function indexedFiles(): IndexedFile[] {
  return [...readIndex().values()];
}

export function indexedFile(relativePath: string): IndexedFile | null {
  return readIndex().get(relativePath) ?? null;
}

/** Files whose declared symbols match the query. Declarations, not references. */
export function findSymbol(name: string, limit = 20): Array<{ path: string; symbol: string }> {
  const needle = name.toLowerCase();
  const results: Array<{ path: string; symbol: string }> = [];
  for (const file of readIndex().values()) {
    for (const symbol of file.symbols) {
      if (symbol.toLowerCase() === needle || symbol.toLowerCase().includes(needle)) {
        results.push({ path: file.path, symbol });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/** Combined hash of the given files, used as a cache invalidation key. */
export function contextHash(paths: string[]): string {
  const index = readIndex();
  const parts = [...paths]
    .sort()
    .map((file) => `${file}:${index.get(file)?.hash ?? 'absent'}`);
  return hashContent(parts.join('|'));
}

export function indexSummary(): { files: number; symbols: number; languages: Record<string, number> } {
  const files = [...readIndex().values()];
  const languages: Record<string, number> = {};
  let symbols = 0;
  for (const file of files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
    symbols += file.symbols.length;
  }
  return { files: files.length, symbols, languages };
}
