import { getDb, asText, asTextOrNull, parseJson } from '@/core/db/database';
import { newId, nowIso } from '@/core/util/id';

/**
 * PROJECT MEMORY / FAILURE MEMORY / DECISION JOURNAL
 *
 * Persistent, per-project knowledge. The orchestrator reads it before planning
 * so an approach that already failed is not silently retried.
 */

export type MemoryKind =
  | 'architecture'
  | 'convention'
  | 'decision'
  | 'problem'
  | 'solution'
  | 'component'
  | 'infrastructure'
  | 'test'
  | 'history';

export interface MemoryEntry {
  id: string;
  projectId: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function rememberMemory(input: {
  projectId: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags?: string[];
}): MemoryEntry {
  const entry: MemoryEntry = {
    id: newId('mem'),
    projectId: input.projectId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    tags: input.tags ?? [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO memories (id, project_id, kind, title, body, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.projectId,
      entry.kind,
      entry.title,
      entry.body,
      JSON.stringify(entry.tags),
      entry.createdAt,
      entry.updatedAt,
    );
  return entry;
}

export function listMemories(projectId: string, kind?: MemoryKind, limit = 200): MemoryEntry[] {
  const db = getDb();
  const rows = kind
    ? db
        .prepare(
          'SELECT * FROM memories WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(projectId, kind, limit)
    : db
        .prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(projectId, limit);
  return rows.map(toMemory);
}

export function searchMemories(projectId: string, query: string, limit = 20): MemoryEntry[] {
  if (query.trim().length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories
       WHERE project_id = ? AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(projectId, `%${query}%`, `%${query}%`, `%${query}%`, limit);
  return rows.map(toMemory);
}

export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
}

function toMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    kind: asText(row.kind) as MemoryKind,
    title: asText(row.title),
    body: asText(row.body),
    tags: parseJson<string[]>(row.tags, []),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export interface FailureEntry {
  id: string;
  projectId: string;
  problem: string;
  attempt: string;
  result: string;
  cause: string;
  validSolution: string | null;
  test: string | null;
  createdAt: string;
}

export function recordFailure(input: Omit<FailureEntry, 'id' | 'createdAt'>): FailureEntry {
  const entry: FailureEntry = { ...input, id: newId('fail'), createdAt: nowIso() };
  getDb()
    .prepare(
      `INSERT INTO failures (id, project_id, problem, attempt, result, cause, valid_solution, test, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.projectId,
      entry.problem,
      entry.attempt,
      entry.result,
      entry.cause,
      entry.validSolution,
      entry.test,
      entry.createdAt,
    );
  return entry;
}

export function listFailures(projectId: string, limit = 100): FailureEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM failures WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit);
  return rows.map((row) => ({
    id: asText(row.id),
    projectId: asText(row.project_id),
    problem: asText(row.problem),
    attempt: asText(row.attempt),
    result: asText(row.result),
    cause: asText(row.cause),
    validSolution: asTextOrNull(row.valid_solution),
    test: asTextOrNull(row.test),
    createdAt: asText(row.created_at),
  }));
}

/** Failures whose problem statement overlaps the current request. */
export function relevantFailures(projectId: string, query: string, limit = 5): FailureEntry[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_$]+/i)
    .filter((token) => token.length > 3);
  if (tokens.length === 0) return [];
  const all = listFailures(projectId, 200);
  return all
    .map((failure) => {
      const haystack = `${failure.problem} ${failure.attempt} ${failure.cause}`.toLowerCase();
      const score = tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
      return { failure, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.failure);
}

export interface DecisionEntry {
  id: string;
  projectId: string;
  decision: string;
  alternatives: string[];
  reason: string;
  evidence: string;
  consequences: string;
  createdAt: string;
}

export function recordDecision(input: Omit<DecisionEntry, 'id' | 'createdAt'>): DecisionEntry {
  const entry: DecisionEntry = { ...input, id: newId('dec'), createdAt: nowIso() };
  getDb()
    .prepare(
      `INSERT INTO decisions (id, project_id, decision, alternatives, reason, evidence, consequences, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.projectId,
      entry.decision,
      JSON.stringify(entry.alternatives),
      entry.reason,
      entry.evidence,
      entry.consequences,
      entry.createdAt,
    );
  return entry;
}

export function listDecisions(projectId: string, limit = 100): DecisionEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit);
  return rows.map((row) => ({
    id: asText(row.id),
    projectId: asText(row.project_id),
    decision: asText(row.decision),
    alternatives: parseJson<string[]>(row.alternatives, []),
    reason: asText(row.reason),
    evidence: asText(row.evidence),
    consequences: asText(row.consequences),
    createdAt: asText(row.created_at),
  }));
}

/** Compact memory digest injected into planner/builder prompts. */
export function memoryDigest(projectId: string, query: string): string {
  const memories = searchMemories(projectId, query, 6);
  const failures = relevantFailures(projectId, query, 4);
  const decisions = listDecisions(projectId, 5);

  const parts: string[] = [];
  if (memories.length > 0) {
    parts.push(
      `KNOWN PROJECT FACTS:\n${memories
        .map((memory) => `- [${memory.kind}] ${memory.title}: ${memory.body.slice(0, 400)}`)
        .join('\n')}`,
    );
  }
  if (failures.length > 0) {
    parts.push(
      `APPROACHES THAT ALREADY FAILED (do not repeat without a reason):\n${failures
        .map((failure) => `- ${failure.attempt} → ${failure.result} (cause: ${failure.cause})`)
        .join('\n')}`,
    );
  }
  if (decisions.length > 0) {
    parts.push(
      `STANDING DECISIONS:\n${decisions
        .map((decision) => `- ${decision.decision} (${decision.reason})`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}
