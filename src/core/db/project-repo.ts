import path from 'node:path';
import { getDb, asText } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';
import { workspaceRoot } from '@/core/paths';
import type { Project } from '@/core/types';

/** Projects map a stable id to a workspace root on disk. */

export function listProjects(): Project[] {
  return getDb()
    .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC')
    .all()
    .map(toProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? toProject(row) : null;
}

export function upsertProject(root: string, name?: string): Project {
  const absolute = path.resolve(root);
  const existing = getDb().prepare('SELECT * FROM projects WHERE root = ?').get(absolute);
  const now = nowIso();
  if (existing) {
    getDb().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(now, asText(existing.id));
    return { ...toProject(existing), lastOpenedAt: now };
  }
  const project: Project = {
    id: newId('proj'),
    name: name ?? path.basename(absolute),
    root: absolute,
    createdAt: now,
    lastOpenedAt: now,
  };
  getDb()
    .prepare('INSERT INTO projects (id, name, root, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)')
    .run(project.id, project.name, project.root, project.createdAt, project.lastOpenedAt);
  return project;
}

/** The project bound to the workspace this server was started on. */
export function currentProject(): Project {
  return upsertProject(workspaceRoot());
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: asText(row.id),
    name: asText(row.name),
    root: asText(row.root),
    createdAt: asText(row.created_at),
    lastOpenedAt: asText(row.last_opened_at),
  };
}
