/**
 * Migrations for the Vision Code persistence layer.
 *
 * SQLite is the initial engine. Statements avoid SQLite-only syntax where a
 * PostgreSQL port would break (no `AUTOINCREMENT` on business tables, ISO-8601
 * text timestamps, explicit primary keys) so the schema can move later.
 */

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        command TEXT NOT NULL,
        prompt TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        round INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        status TEXT NOT NULL,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id)`,
      `CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        author TEXT NOT NULL,
        operations TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_patches_task ON patches(task_id)`,
      `CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        project_id TEXT NOT NULL,
        runner TEXT NOT NULL,
        command TEXT NOT NULL,
        exit_code INTEGER,
        verdict TEXT NOT NULL,
        passed INTEGER,
        failed INTEGER,
        total INTEGER,
        duration_ms INTEGER,
        output TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, kind)`,
      `CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        alternatives TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT NOT NULL,
        consequences TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS failures (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        problem TEXT NOT NULL,
        attempt TEXT NOT NULL,
        result TEXT NOT NULL,
        cause TEXT NOT NULL,
        valid_solution TEXT,
        test TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_failures_project ON failures(project_id)`,
      `CREATE TABLE IF NOT EXISTS benchmarks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        label TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        auth_method TEXT NOT NULL,
        key_path TEXT,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        risk TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_job_events_task ON job_events(task_id, id)`,
      `CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        project_id TEXT,
        task_id TEXT,
        agent TEXT,
        process_id TEXT,
        data TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(id DESC)`,
    ],
  },
  {
    version: 2,
    name: 'repository-index-and-model-cache',
    statements: [
      // Incremental repository index: a file is only re-parsed when its hash moves.
      `CREATE TABLE IF NOT EXISTS file_index (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        modified_at TEXT NOT NULL,
        language TEXT NOT NULL,
        symbols TEXT NOT NULL,
        imports TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_file_index_hash ON file_index(hash)`,
      // Reusable model answers, invalidated by the content they were derived from.
      `CREATE TABLE IF NOT EXISTS model_cache (
        key TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        response TEXT NOT NULL,
        context_hash TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        hits INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_model_cache_used ON model_cache(last_used_at DESC)`,
      // Per-task token accounting, so a budget can be enforced and reported.
      `CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        estimated INTEGER NOT NULL,
        cached INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task_id)`,
    ],
  },
];
