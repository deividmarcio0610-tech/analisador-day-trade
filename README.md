# VISION CODE

A web platform for multi-agent software engineering, running on **local models**.
Two agents work as a council — a builder that writes code and a reviewer that
tries to reject it — and an **Engineering Judge** that only trusts commands that
actually ran.

The product does not depend on any hosted AI provider. Models are reached
through an abstract `ModelProvider` interface with implementations for **Ollama**,
**vLLM** and any **OpenAI-compatible** endpoint. Roles (`builder`, `reviewer`,
`planner`, `judge`) are mapped to models in Settings, so swapping the models is a
configuration change, not a code change.

## Requirements

- Node.js **>= 22.13** (the platform uses the built-in `node:sqlite`, no native build step)
- git (optional, but checkpoints, diffs and worktrees need it)
- A local model server — Ollama by default at `http://127.0.0.1:11434`

## Running

```bash
npm install
npm run dev            # http://localhost:3000
```

The workspace Vision operates on defaults to the directory it was started in.
Point it elsewhere with environment variables:

```bash
VISION_WORKSPACE_ROOT=/path/to/project npm run dev
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `VISION_WORKSPACE_ROOT` | Directory the agent may read, write and run commands in | `process.cwd()` |
| `VISION_DATA_DIR` | Where the SQLite database and checkpoints live | `<workspace>/.vision` |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `VLLM_BASE_URL` | vLLM endpoint | `http://127.0.0.1:8000/v1` |
| `OPENAI_COMPATIBLE_BASE_URL` | Any OpenAI-compatible endpoint | `http://127.0.0.1:8080/v1` |

API keys are never stored in the database or sent to the browser: a provider
declares the **name** of an environment variable, and the server reads it at call
time.

Suggested models (any instruct/coder model works):

```bash
ollama pull qwen2.5-coder:14b     # builder / planner
ollama pull deepseek-r1:14b       # reviewer / challenge rounds
```

Then set them per role in **Settings**. With no model server reachable, every
screen still works — providers report `OFFLINE` or `NOT CONFIGURED`, and the
tools (filesystem, terminal, git, tests, analysis) run normally.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify        # all four, in order
```

## How a task runs

```
prompt → Context Engine → Planner → Builder → Reviewer → (revision rounds)
       → apply patch → lint / typecheck / test / build → Engineering Judge → Evidence
```

The judge is deterministic code, not a model: it reads exit codes and reviewer
findings. A check that never ran is `NOT_RUN`, never `PASS`. A patch that was not
applied cannot be reported as verified.

### Modes

| Mode | Behaviour |
| --- | --- |
| `FAST` | One builder pass, one review, smallest context |
| `ENGINEER` | Plan → build → review → revise (default) |
| `DEEP_ANALYSIS` | Adversarial review, root cause required, up to 3 rounds |
| `ARCHITECT` | Design only: requirements, architecture, implementation order |
| `DEBUG` | Hypothesis board from real evidence, then a targeted fix |
| `TEAM` | Full council, three review rounds |
| `EXTREME` | Two independent solutions, cross review, isolated verification, evidence decides |

### Commands

`/solve` `/debug` `/architect` `/research` `/review` `/challenge` `/prove`
`/compare` `/lab` `/finalize` `/audit` `/test` `/build` `/status` `/health`
`/git` `/database` `/performance` `/vps` `/gpu`

Type `/` in the prompt bar to see them with their usage.

## Screens

- **Dashboard** — council status, measured project health, verification shortcuts
- **Workspace** — file explorer, Monaco editor, terminal, problems, tests, logs, diff
- **AI Council** — live timeline, agent output, patch diff, review findings, judge verdict
- **Architect** — design output plus a navigable code graph with blast radius
- **Debug** — hypothesis board (investigating / discarded / probable / confirmed)
- **Tests / Quality / Performance / Database / Git** — evidence, all from real runs
- **Deploy / VPS / GPU** — infrastructure status, honest about what is not configured
- **Memory** — project memory, failure memory, decision journal
- **Lab / Research / Settings**

## Safety

- Every filesystem path is resolved inside the workspace root; escapes are refused.
- Shell commands are classified `SAFE` / `REVIEW` / `CRITICAL`. `CRITICAL` commands
  (recursive delete, force push, hard reset, `sudo`, piping a remote script into a
  shell, destructive SQL…) are refused unless the caller confirms explicitly.
- Every command is written to an audit log with its risk and its reason.
- A git checkpoint (a tag over a `git stash create` commit, so the working tree is
  untouched) is taken before any patch is applied.
- Secrets are detected but **masked** — never echoed into the UI or the logs.

## Architecture

```
Browser (Next.js UI)
   │  REST + Server-Sent Events
Vision backend (Next route handlers)
   │
   ├── Orchestrator ── Council (planner/builder/reviewer) ── Model Router ── Providers ── Ollama / vLLM / OpenAI-compatible
   ├── Engineering Judge (deterministic, evidence only)
   ├── Tools: filesystem · terminal · git · test engine · database doctor · GPU · VPS
   ├── Context Engine · Code Graph · Impact Analyzer
   ├── Quality: technical debt · secret guard · API contract guard · security review
   └── SQLite: projects, tasks, agent runs, messages, patches, test runs, memories,
       decisions, failures, benchmarks, connections, settings, audit logs, job events
```

Jobs stream their progress as events that are **persisted before they are
emitted**, so reloading the page replays the full history and then continues live.

```
src/
  app/           Next.js routes (UI) and /api route handlers
  components/    UI components and hooks
  core/
    agents/      prompts, structured council calls, engineering judge
    commands/    native command registry, /prove and /finalize reports
    config/      providers, per-role models, orchestrator settings
    context/     context engine, code graph, impact analyzer
    db/          SQLite connection, migrations, repositories
    memory/      project memory, failure memory, decision journal
    orchestrator/ job store, run modes, orchestration, tournament, patch service
    providers/   ModelProvider implementations and the model router
    quality/     technical debt, secrets, API contract, security, project health
    safety/      command risk classification
    tools/       filesystem, process runner, git, test engine, database, GPU, VPS
tests/           unit tests plus an end-to-end council run
```

## Status

Implemented and verified: providers, model router, orchestration with review
rounds, deterministic judge, patch preview/apply with checkpoints, test engine,
terminal with command safety, git integration, context engine, code graph, impact
analyzer, memory, quality engines, SQLite persistence with migrations, SSE
streaming, and the full web IDE.

Not implemented, and reported as `NOT CONFIGURED` rather than faked: deployment
targets, browser/E2E automation (Playwright is detected and can be run through the
test engine, but Vision does not drive a browser itself), and visual regression
comparison.
