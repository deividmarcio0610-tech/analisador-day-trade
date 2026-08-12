import { getDb, asBoolean, asNumber, asText, parseJson } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import { readFile, writeFile, deleteFile, pathExists } from '@/core/tools/filesystem';
import { unifiedDiff, type UnifiedDiff } from '@/core/util/diff';
import { createCheckpoint } from '@/core/tools/git';
import { logger } from '@/core/logging/logger';
import { analyzeImpact, type ImpactReport } from '@/core/context/impact';
import type { PatchOperation } from '@/core/types';

/**
 * PATCH SERVICE
 *
 * A patch is stored, previewed as a real diff and only written to disk when
 * applied. Applying always takes a git checkpoint first, so nothing the agents
 * do is unrecoverable.
 */

export interface PatchRecord {
  id: string;
  taskId: string;
  round: number;
  author: string;
  operations: PatchOperation[];
  applied: boolean;
  createdAt: string;
}

export function storePatch(input: {
  taskId: string;
  round: number;
  author: string;
  operations: PatchOperation[];
}): PatchRecord {
  const record: PatchRecord = {
    id: newId('patch'),
    taskId: input.taskId,
    round: input.round,
    author: input.author,
    operations: input.operations,
    applied: false,
    createdAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO patches (id, task_id, round, author, operations, applied, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      record.id,
      record.taskId,
      record.round,
      record.author,
      JSON.stringify(record.operations),
      record.createdAt,
    );
  return record;
}

export function getPatch(id: string): PatchRecord | null {
  const row = getDb().prepare('SELECT * FROM patches WHERE id = ?').get(id);
  return row ? toRecord(row) : null;
}

export function listPatches(taskId?: string, limit = 50): PatchRecord[] {
  const db = getDb();
  const rows = taskId
    ? db.prepare('SELECT * FROM patches WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(taskId, limit)
    : db.prepare('SELECT * FROM patches ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(toRecord);
}

function toRecord(row: Record<string, unknown>): PatchRecord {
  return {
    id: asText(row.id),
    taskId: asText(row.task_id),
    round: asNumber(row.round),
    author: asText(row.author),
    operations: parseJson<PatchOperation[]>(row.operations, []),
    applied: asBoolean(row.applied),
    createdAt: asText(row.created_at),
  };
}

export interface PatchPreview {
  diffs: UnifiedDiff[];
  additions: number;
  deletions: number;
  created: string[];
  deleted: string[];
  impact: ImpactReport;
}

export async function previewPatch(operations: PatchOperation[]): Promise<PatchPreview> {
  const diffs: UnifiedDiff[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const operation of operations) {
    if (operation.action === 'delete') {
      deleted.push(operation.path);
      const existing = await safeRead(operation.path);
      const diff = unifiedDiff(operation.path, existing, '');
      diffs.push(diff);
      additions += diff.stats.additions;
      deletions += diff.stats.deletions;
      continue;
    }

    const exists = await pathExists(operation.path);
    if (!exists) created.push(operation.path);
    const before = exists ? await safeRead(operation.path) : '';
    const after = operation.content ?? '';
    const diff = unifiedDiff(operation.path, before, after);
    diffs.push(diff);
    additions += diff.stats.additions;
    deletions += diff.stats.deletions;
  }

  const impact = await analyzeImpact(operations.map((operation) => operation.path));
  return { diffs, additions, deletions, created, deleted, impact };
}

async function safeRead(relativePath: string): Promise<string> {
  try {
    const result = await readFile(relativePath);
    return result.binary ? '' : result.content;
  } catch {
    return '';
  }
}

export interface ApplyResult {
  patchId: string;
  checkpoint: string | null;
  written: string[];
  removed: string[];
  errors: Array<{ path: string; error: string }>;
}

/** Write a stored patch to disk. Takes a checkpoint before the first write. */
export async function applyPatch(patchId: string): Promise<ApplyResult> {
  const patch = getPatch(patchId);
  if (!patch) throw new Error(`Patch not found: ${patchId}`);
  if (patch.applied) throw new Error(`Patch ${patchId} was already applied`);

  const checkpoint = await createCheckpoint(`apply-${patchId}`);
  const written: string[] = [];
  const removed: string[] = [];
  const errors: ApplyResult['errors'] = [];

  for (const operation of patch.operations) {
    try {
      if (operation.action === 'delete') {
        await deleteFile(operation.path);
        removed.push(operation.path);
      } else {
        if (operation.content === undefined) {
          throw new Error('operation has no content');
        }
        await writeFile(operation.path, operation.content);
        written.push(operation.path);
      }
    } catch (error) {
      errors.push({ path: operation.path, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (errors.length === 0) {
    getDb().prepare('UPDATE patches SET applied = 1 WHERE id = ?').run(patchId);
  }

  logger.info('patch', `applied ${patchId}: ${written.length} written, ${removed.length} removed`, {
    taskId: patch.taskId,
    data: { errors: errors.length, checkpoint: checkpoint?.tag ?? null },
  });

  return { patchId, checkpoint: checkpoint?.tag ?? null, written, removed, errors };
}

/** Render a patch as text for a reviewer prompt. */
export async function renderPatchForReview(operations: PatchOperation[]): Promise<string> {
  const preview = await previewPatch(operations);
  const parts: string[] = [];
  for (const diff of preview.diffs) {
    parts.push(diff.text.length > 0 ? diff.text : `--- a/${diff.path}\n+++ b/${diff.path}\n(no textual change)`);
  }
  return parts.join('\n\n');
}
