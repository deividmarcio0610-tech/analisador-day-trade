import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * End-to-end orchestration test.
 *
 * A real HTTP server speaks the Ollama protocol so the provider, the router,
 * the council loop, the patch service and the judge all run for real — only the
 * weights are replaced. The server records what it received, which is how the
 * test asserts that each role was actually called.
 */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-orch-'));
let server: http.Server;
let baseUrl = '';
const received: Array<{ system: string; user: string }> = [];

const PLAN = {
  summary: 'Add a greeting helper',
  requirements: [{ id: 'GREET-001', statement: 'greet returns a greeting', verification: 'unit test' }],
  steps: [{ id: 'S1', title: 'create helper', detail: 'add src/greet.ts', files: ['src/greet.ts'] }],
  risks: [],
};

const PATCH = {
  summary: 'Add greet helper',
  operations: [
    {
      path: 'src/greet.ts',
      action: 'create',
      content: 'export const greet = (name: string): string => `hello ${name}`;\n',
      rationale: 'implements GREET-001',
    },
  ],
  notes: [],
};

const REVIEW = { decision: 'APPROVED', findings: [] };

function replyFor(system: string): string {
  if (system.includes('PLANNER')) return JSON.stringify(PLAN);
  if (system.includes('BUILDER')) return JSON.stringify(PATCH);
  if (system.includes('REVIEWER')) return JSON.stringify(REVIEW);
  return '{}';
}

beforeAll(async () => {
  process.env.VISION_WORKSPACE_ROOT = workspace;
  process.env.VISION_DATA_DIR = path.join(workspace, '.vision');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const version = 1;\n');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'orch-fixture', scripts: { test: 'echo ok', build: 'echo built' } }),
  );

  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (request.url === '/api/tags') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ models: [{ name: 'fixture-model', size: 1 }] }));
        return;
      }
      if (request.url === '/api/chat') {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }>; stream?: boolean };
        const system = parsed.messages.find((message) => message.role === 'system')?.content ?? '';
        const user = parsed.messages.find((message) => message.role === 'user')?.content ?? '';
        received.push({ system, user });
        const content = replyFor(system);

        if (parsed.stream) {
          response.writeHead(200, { 'content-type': 'application/x-ndjson' });
          response.write(`${JSON.stringify({ message: { content }, done: false })}\n`);
          response.end(`${JSON.stringify({ message: { content: '' }, done: true })}\n`);
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: { content }, prompt_eval_count: 10, eval_count: 20 }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { setProviders, setAgents, setOrchestratorConfig } = await import('@/core/config/config');
  setProviders([
    { id: 'fixture', label: 'Fixture', kind: 'ollama', baseUrl, enabled: true },
  ]);
  setAgents(
    (['planner', 'builder', 'reviewer', 'judge'] as const).map((role) => ({
      role,
      label: role,
      providerId: 'fixture',
      model: 'fixture-model',
      temperature: 0,
      maxTokens: 1024,
    })),
  );
  setOrchestratorConfig({ maxRounds: 2, autoApplyPatches: false, runTestsAutomatically: true });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('provider protocol', () => {
  it('reports ONLINE and lists models from the real endpoint', async () => {
    const { getProvider } = await import('@/core/providers/registry');
    const provider = getProvider('fixture');
    const health = await provider.health();
    expect(health.status).toBe('ONLINE');
    expect(health.models).toContain('fixture-model');
  });

  it('streams deltas and returns the assembled content', async () => {
    const { getProvider } = await import('@/core/providers/registry');
    const provider = getProvider('fixture');
    let streamed = '';
    for await (const chunk of provider.stream({
      model: 'fixture-model',
      messages: [
        { role: 'system', content: 'You are the BUILDER' },
        { role: 'user', content: 'build' },
      ],
    })) {
      streamed += chunk.delta;
    }
    expect(JSON.parse(streamed)).toMatchObject({ summary: 'Add greet helper' });
  });
});

describe('council pipeline', () => {
  it('runs planner → builder → reviewer → judge and produces a real patch', async () => {
    const { createJob, eventsSince, getJob } = await import('@/core/orchestrator/job-store');
    const { runOrchestration } = await import('@/core/orchestrator/orchestrator');
    const { listPatches } = await import('@/core/orchestrator/patch-service');

    const job = createJob({
      projectId: 'fixture',
      mode: 'ENGINEER',
      command: 'solve',
      prompt: 'add a greet helper to src',
    });
    const outcome = await runOrchestration({ job });

    // Every role was really invoked over HTTP.
    expect(received.some((entry) => entry.system.includes('PLANNER'))).toBe(true);
    expect(received.some((entry) => entry.system.includes('BUILDER'))).toBe(true);
    expect(received.some((entry) => entry.system.includes('REVIEWER'))).toBe(true);

    // The builder's output became a stored patch with real operations.
    expect(outcome.patchId).not.toBeNull();
    const patches = listPatches(job.id);
    expect(patches[0]?.operations[0]?.path).toBe('src/greet.ts');

    // The reviewer approved, so the loop stopped after one round.
    expect(outcome.review?.decision).toBe('APPROVED');
    expect(outcome.rounds).toBe(1);

    // The patch was not applied, so the judge must not claim success.
    expect(outcome.applied).toBe(false);
    expect(outcome.judgeReport?.verdict).toBe('NOT_RUN');
    expect(fs.existsSync(path.join(workspace, 'src', 'greet.ts'))).toBe(false);
    expect(getJob(job.id)?.state).toBe('WAITING_REVIEW');

    // The timeline was published for the UI.
    const stages = eventsSince(job.id, 0)
      .filter((event) => event.type === 'timeline')
      .map((event) => (event.payload as { stage: string }).stage);
    for (const stage of ['context', 'analysis', 'planning', 'implementation', 'review', 'tests', 'validation']) {
      expect(stages, stage).toContain(stage);
    }
  });

  it('applies the patch and judges it PASS when the checks really run', async () => {
    const { createJob, getJob } = await import('@/core/orchestrator/job-store');
    const { runOrchestration } = await import('@/core/orchestrator/orchestrator');

    const job = createJob({
      projectId: 'fixture',
      mode: 'FAST',
      command: 'solve',
      prompt: 'add a greet helper to src',
    });
    const outcome = await runOrchestration({ job, applyAndVerify: true, checks: ['test', 'build'] });

    expect(outcome.applied).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'src', 'greet.ts'), 'utf8')).toContain('greet');
    expect(outcome.judgeReport?.verdict).toBe('PASS');
    expect(outcome.judgeReport?.evidence.map((item) => item.label).sort()).toEqual(['build', 'test']);
    expect(getJob(job.id)?.state).toBe('PASSED');
  });

  it('sends the workspace context and the plan to the builder', async () => {
    const builderPrompts = received.filter((entry) => entry.system.includes('BUILDER'));
    const last = builderPrompts[builderPrompts.length - 1];
    expect(last?.user).toContain('PROJECT STACK');
    expect(last?.user).toContain('add a greet helper');
  });
});
