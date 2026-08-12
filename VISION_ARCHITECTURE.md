# VISION ARCHITECTURE

Only the decisions that constrain future work. Everything else is in the code.

## Boundaries

```
Browser (Next.js UI)  →  Vision backend (route handlers)  →  Workspace agent (core)
                                                              ├── filesystem · terminal · git · tests
                                                              └── ModelProvider → Ollama / vLLM / OpenAI-compatible
```

- `src/core/**` is the engine: no React, no `next/*`. It is the only layer that
  touches the filesystem, processes or models.
- `src/app/api/**` validates input with zod and returns errors through
  `handleError`, so domain errors keep their status code.
- The browser never gets filesystem or terminal access; it asks the backend.

## Decisions

**No hosted-AI dependency in the product.** Models are reached only through
`ModelProvider`. Nothing outside `src/core/providers/` knows which vendor or
model family backs a role. Roles (`planner`, `builder`, `reviewer`) are abstract;
Qwen and DeepSeek are configuration, not code.

**The judge is deterministic code, not a model.** `src/core/agents/judge.ts`
reads exit codes and reviewer findings. Reviewer findings can only make a verdict
worse. A check that did not run is `NOT_RUN`, never `PASS`.

**Health is verified, never inferred.** A role is `ONLINE` only after its model
answered a real completion with usable content and, when the server reports one,
the model used matches the one requested. `OFFLINE` (unreachable), `ERROR`
(reachable but wrong) and `NOT_CONFIGURED` are distinct and never collapsed.

**Endpoint dialect is detected, not assumed.** The probe tries `/api/tags`,
`/models` and `/v1/models` and uses whichever answers, so an Ollama or an
OpenAI-compatible server behind the same URL both work.

**Secrets stay server-side.** A provider stores the *name* of an environment
variable; the value is read at call time and never enters the database, the API
payloads or the client bundle (verified by a canary in the build).

**`node:sqlite`, not a native addon.** Installs with plain `npm install` on
Node >= 22.13. Migrations live in `MIGRATIONS` (`src/core/db/schema.ts`) and an
applied migration is never edited. Schema avoids SQLite-only syntax so a
PostgreSQL port stays open.

**Jobs persist their events before emitting them.** SSE replays history from
SQLite, then continues live, so a reload never loses a running job.

**Writes are recoverable.** `applyPatch` takes a git checkpoint first (a tag over
a `git stash create` commit, so the working tree is untouched). Concurrent agents
use separate worktrees.

**Destructive commands need explicit confirmation.** Classification lives in
`src/core/safety/command-safety.ts`; `runCommand` refuses `CRITICAL` without
`confirmed: true`, and every command is audited with its risk and reason.

**Degrade, never crash.** If the GPU disappears, council runs are `BLOCKED` with
`GPU/MODEL UNAVAILABLE` while workspace, terminal, git, tests and analysis keep
working. Temporary failures retry with exponential backoff and jitter; a rejected
key does not.

**Reasoning models are first-class.** `<think>` blocks are stripped before JSON
parsing, because their prose contains braces that would otherwise be read as
structured output.

**In-memory registries go through `singleton()`** so they survive hot reload.
