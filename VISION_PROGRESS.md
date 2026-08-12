# VISION PROGRESS

State file for resuming without re-reading the whole specification.
Update after each module. `npm run verify` = lint → typecheck → test → build.

## DONE

- **Phase 1 — bootstrap + architecture + UI**: Next.js 15 / React 19 / TS strict
  (`noUncheckedIndexedAccess`) / Tailwind 4. 17 screens, dark Vision identity.
- **Phase 2 — workspace**: file tree, tabs, Monaco (bundled locally, no CDN),
  save, search, replace, project search, diff, changed files, ignore list.
- **Phase 3 — providers**: `ModelProvider` with Ollama, vLLM and
  OpenAI-compatible implementations; model router by role; remote GPU endpoint
  with dialect auto-detection; health = real completion, not HTTP 200.
- **Phase 4 — orchestrator**: planner → builder → reviewer → revision → tests →
  deterministic Engineering Judge. 7 run modes. Max 3 rounds.
- **Phase 5 — terminal/git/tests**: real process execution with SAFE/REVIEW/
  CRITICAL classification, cancellation, audit log; git status/diff/log/branch/
  stash/worktree/checkpoint; stack-detecting test engine.
- **Phase 6 — commands**: 20 native commands (`/solve` … `/gpu`), debug
  hypothesis board, `/prove` evidence report, `/finalize` sweep.
- **Phase 7 — persistence**: SQLite via `node:sqlite`, 18 tables + migrations,
  project memory, failure memory, decision journal.
- **Phase 8 — context**: context engine with budget, code graph + navigable
  viewer, impact analyzer.
- **Phase 9 — infrastructure**: GPU telemetry (nvidia-smi/rocm-smi), VPS
  connections with server-side auth, diagnostics endpoint, SSE realtime.
- **Phase 10 — lab**: EXTREME tournament in isolated worktrees, model router
  statistics, performance lab.
- **Phase 12 — audit**: self-audit run; every defect it found was fixed
  (contract guard blind to wrapper/multiline calls, scanners matching their own
  rules, truncation exceeding its budget, dead route, orphan detection).
- **Remote GPU integration**: env + Settings configuration, 4 health states,
  retry with backoff, GPU/MODEL UNAVAILABLE degradation, `/api/ai/diagnostics`,
  `/api/ai/test`, `npm run validate:ai`.
- **Reasoning models**: `<think>` blocks stripped before JSON parsing (qwen3,
  deepseek-r1).

LAST_BUILD: PASS — lint, typecheck, 115 tests, build.

## CURRENT

Waiting on one real value to validate against the user's GPU.

## PENDING

- **Phase 11 — Playwright / E2E / visual regression**: not implemented. The test
  engine detects and runs Playwright if the project has it, but Vision does not
  drive a browser itself. Reported as NOT CONFIGURED, not faked.
- AUTOPILOT loop (plan → implement → review → test → repeat until PASS/BLOCKED)
  as a single command; the pieces exist, the loop is manual today.
- DIAGNOSTICS screen aggregating every subsystem in one view (per-area status
  already exists on each screen and in `/api/ai/diagnostics`).
- Deploy integration: intentionally NOT CONFIGURED.

## BLOCKED

- **Real validation of Qwen + DeepSeek**: needs `VISION_DEEPSEEK_MODEL` (exact
  id from `ollama list` on the GPU host). Endpoint is
  `http://127.0.0.1:11435` via reverse SSH tunnel, so validation must run **on
  the VPS where the tunnel terminates** — a container without that tunnel cannot
  reach it.

## NEXT

1. Get the DeepSeek model id, set it in `.env.local` or Settings.
2. On the VPS: `npm run dev` + `npm run validate:ai`.
3. If both roles are ONLINE and TEAM/STREAMING/FAILOVER pass, continue to
   Phase 11 (Playwright/E2E) and the AUTOPILOT loop.
