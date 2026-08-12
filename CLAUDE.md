# Working in this repository

VISION CODE — a web platform for multi-agent software engineering on local models.
See `README.md` for what it does and how to run it.

## Verify before claiming anything works

```bash
npm run verify     # lint → typecheck → test → build
```

Individually: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.

Requires Node >= 22.13 (`node:sqlite` is used directly, so there is no native
build step and no `better-sqlite3`).

## Rules this codebase holds itself to

These are the product's own promises; code that breaks them is a defect.

1. **No hosted-AI dependency in the product.** Models are reached only through
   `ModelProvider`. Nothing outside `src/core/providers/` may know which vendor or
   model family is behind a role.
2. **Never report a result that did not happen.** `Verdict` has `NOT_RUN` and
   `BLOCKED` for a reason. The judge (`src/core/agents/judge.ts`) is deterministic
   code, and reviewer findings can only make a verdict worse, never better.
3. **No mock presented as a feature.** When an integration does not exist, the UI
   says `NOT CONFIGURED`. Mocks belong in `tests/`, never in a screen.
4. **Paths stay in the workspace.** Every path goes through `resolveInside()`
   (`src/core/paths.ts`).
5. **Destructive commands need explicit confirmation.** Classification lives in
   `src/core/safety/command-safety.ts`; `runCommand` refuses `CRITICAL` without
   `confirmed: true`.
6. **Checkpoint before writing.** `applyPatch` takes a git checkpoint first.
7. **Secrets are masked**, never echoed into the UI or the logs.

## Layout

- `src/core/**` — engine. No React, no `next/*` imports.
- `src/app/api/**` — route handlers. Validate input with zod, return errors through
  `handleError` so domain errors keep their status code.
- `src/app/**/page.tsx`, `src/components/**` — UI. Client components talk to the
  API through `src/lib/api.ts` or the hooks in `src/components/hooks/`.
- `tests/**` — vitest. Runtime tests create a temporary workspace and set
  `VISION_WORKSPACE_ROOT` / `VISION_DATA_DIR`; they never touch this repository.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on — index access yields
  `T | undefined`, handle it rather than asserting.
- `@typescript-eslint/no-explicit-any` is an error. Use `unknown` and narrow.
- Comments explain *why*. Do not narrate what the next line already says.
- New API route: add `export const runtime = 'nodejs'` and
  `export const dynamic = 'force-dynamic'`.
- New table: add a migration to `MIGRATIONS` in `src/core/db/schema.ts`. Never edit
  an applied migration.
- In-memory registries go through `singleton()` (`src/core/util/singleton.ts`) so
  they survive hot reload.

## Self-audit

The platform can review itself:

```bash
npm run dev
# then, in the prompt bar
/audit        # technical debt, secrets, API contract, security review
/finalize     # pending work, missing commands, blockers
```

The API contract guard compares route files against the endpoints the client
really calls, so a route nothing calls will be reported — either wire it up or
delete it.
