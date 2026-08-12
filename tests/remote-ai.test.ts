import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Remote GPU integration.
 *
 * A real HTTP server stands in for the GPU host and can be told to behave badly
 * (auth rejection, empty completion, wrong model, flaky connection), which is
 * the only way to prove the health states mean what they claim.
 */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-remote-'));

type Behaviour =
  | 'ollama-ok'
  | 'openai-ok'
  | 'openai-v1-ok'
  | 'auth-error'
  | 'empty-completion'
  | 'wrong-model'
  | 'missing-model'
  | 'flaky-then-ok'
  | 'server-error'
  | 'council-ok';

let behaviour: Behaviour = 'ollama-ok';
let server: http.Server;
let baseUrl = '';
let requestCount = 0;
let authHeaders: Array<string | undefined> = [];

function json(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

beforeAll(async () => {
  process.env.VISION_WORKSPACE_ROOT = workspace;
  process.env.VISION_DATA_DIR = path.join(workspace, '.vision');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'remote-fixture', scripts: { test: 'echo ok', build: 'echo built' } }),
  );

  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      requestCount += 1;
      authHeaders.push(request.headers.authorization);
      const url = request.url ?? '';

      if (behaviour === 'auth-error') return json(response, 401, { error: 'invalid api key' });
      if (behaviour === 'server-error') return json(response, 503, { error: 'model loading' });
      if (behaviour === 'flaky-then-ok' && requestCount <= 2) {
        response.destroy();
        return;
      }

      const isOllamaTags = url === '/api/tags';
      const isOllamaChat = url === '/api/chat';
      const isOpenAiModels = url === '/models' || url === '/v1/models';
      const isOpenAiChat = url === '/chat/completions' || url === '/v1/chat/completions';

      const ollamaEnabled = behaviour === 'ollama-ok' || behaviour === 'flaky-then-ok' ||
        behaviour === 'empty-completion' || behaviour === 'wrong-model' || behaviour === 'missing-model' ||
        behaviour === 'council-ok';
      const openAiEnabled = behaviour === 'openai-ok' || behaviour === 'openai-v1-ok';

      if (isOllamaTags && ollamaEnabled) {
        return json(response, 200, { models: [{ name: 'qwen-fixture', size: 1 }, { name: 'deepseek-fixture' }] });
      }
      if (isOpenAiModels && openAiEnabled) {
        // 'openai-v1-ok' only answers under /v1, so the probe must find it there.
        if (behaviour === 'openai-v1-ok' && url !== '/v1/models') return json(response, 404, { error: 'not found' });
        if (behaviour === 'openai-ok' && url !== '/models') return json(response, 404, { error: 'not found' });
        return json(response, 200, { data: [{ id: 'qwen-fixture' }, { id: 'deepseek-fixture' }] });
      }

      if (isOllamaChat && ollamaEnabled) {
        const parsed = JSON.parse(body) as {
          model: string;
          messages: Array<{ role: string; content: string }>;
        };

        // Answers like a real council would, so the pipeline check can be exercised.
        if (behaviour === 'council-ok') {
          const system = parsed.messages.find((message) => message.role === 'system')?.content ?? '';
          const content = system.includes('BUILDER')
            ? JSON.stringify({
                summary: 'Add the helper',
                operations: [
                  {
                    path: 'src/vision-selftest.ts',
                    action: 'create',
                    content: 'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\n',
                  },
                ],
                notes: [],
              })
            : system.includes('REVIEWER')
              ? JSON.stringify({ decision: 'APPROVED', findings: [] })
              : 'VISION-OK';
          return json(response, 200, { model: parsed.model, message: { content } });
        }

        if (behaviour === 'missing-model') {
          return json(response, 200, { error: `model '${parsed.model}' not found, try pulling it first` });
        }
        if (behaviour === 'empty-completion') {
          return json(response, 200, { model: parsed.model, message: { content: '' } });
        }
        if (behaviour === 'wrong-model') {
          return json(response, 200, { model: 'some-other-model', message: { content: 'VISION-OK' } });
        }
        return json(response, 200, {
          model: parsed.model,
          message: { content: 'VISION-OK' },
          prompt_eval_count: 3,
          eval_count: 2,
        });
      }

      if (isOpenAiChat && openAiEnabled) {
        const parsed = JSON.parse(body) as { model: string };
        return json(response, 200, {
          model: parsed.model,
          choices: [{ message: { content: 'VISION-OK' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        });
      }

      return json(response, 404, { error: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

/**
 * The suite must not depend on the developer's own environment: a machine that
 * really has VISION_AI_BASE_URL exported would otherwise change the results.
 */
async function resetEnvironment(): Promise<void> {
  behaviour = 'ollama-ok';
  requestCount = 0;
  authHeaders = [];
  const { setRemoteOverride } = await import('@/core/config/config');
  setRemoteOverride({ baseUrl: '', builderModel: '', reviewerModel: '' });
  delete process.env.VISION_AI_BASE_URL;
  delete process.env.VISION_QWEN_MODEL;
  delete process.env.VISION_DEEPSEEK_MODEL;
  delete process.env.VISION_AI_API_KEY;
  delete process.env.VISION_AI_TIMEOUT;
}

beforeEach(resetEnvironment);
afterEach(resetEnvironment);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function configureRemote(models = { builder: 'qwen-fixture', reviewer: 'deepseek-fixture' }): Promise<void> {
  process.env.VISION_AI_BASE_URL = baseUrl;
  process.env.VISION_QWEN_MODEL = models.builder;
  process.env.VISION_DEEPSEEK_MODEL = models.reviewer;
}

describe('remote configuration', () => {
  it('is NOT_CONFIGURED until an endpoint is provided', async () => {
    const { remoteConfigured, getProviderConfig, REMOTE_PROVIDER_ID } = await import('@/core/config/config');
    expect(remoteConfigured()).toBe(false);
    expect(getProviderConfig(REMOTE_PROVIDER_ID)?.enabled).toBe(false);
  });

  it('binds Qwen to the builder and DeepSeek to the reviewer', async () => {
    await configureRemote();
    const { getAgentConfig, REMOTE_PROVIDER_ID } = await import('@/core/config/config');
    expect(getAgentConfig('builder')).toMatchObject({
      providerId: REMOTE_PROVIDER_ID,
      model: 'qwen-fixture',
    });
    expect(getAgentConfig('reviewer')).toMatchObject({
      providerId: REMOTE_PROVIDER_ID,
      model: 'deepseek-fixture',
    });
  });

  it('never invents a model name when the variable is missing', async () => {
    process.env.VISION_AI_BASE_URL = baseUrl;
    const { getAgentConfig } = await import('@/core/config/config');
    expect(getAgentConfig('builder').model).toBe('');
    const { roleUnavailableReason } = await import('@/core/providers/ai-health');
    expect(roleUnavailableReason('builder')).toContain('VISION_QWEN_MODEL');
  });

  it('lets Settings override the endpoint without touching the environment', async () => {
    process.env.VISION_AI_BASE_URL = 'http://from-env.invalid';
    const { setRemoteOverride, remoteBaseUrl, remoteBaseUrlSource } = await import('@/core/config/config');
    setRemoteOverride({ baseUrl: baseUrl });
    expect(remoteBaseUrl()).toBe(baseUrl);
    expect(remoteBaseUrlSource()).toBe('settings');

    setRemoteOverride({ baseUrl: '' });
    expect(remoteBaseUrl()).toBe('http://from-env.invalid');
    expect(remoteBaseUrlSource()).toBe('env');
  });

  it('clamps the timeout instead of trusting a typo', async () => {
    const { clampTimeout, remoteTimeoutMs } = await import('@/core/config/config');
    expect(clampTimeout(5)).toBe(1_000);
    expect(clampTimeout(99_999_999)).toBe(3_600_000);
    process.env.VISION_AI_TIMEOUT = '45000';
    expect(remoteTimeoutMs()).toBe(45_000);
  });

  it('infers the dialect from the endpoint shape', async () => {
    const { inferProviderKind } = await import('@/core/config/config');
    expect(inferProviderKind('https://host:8000/v1')).toBe('openai-compatible');
    expect(inferProviderKind('https://host:11434')).toBe('ollama');
  });
});

describe('endpoint probe', () => {
  it('detects a native Ollama endpoint', async () => {
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const probe = await probeEndpoint(baseUrl);
    expect(probe.status).toBe('ONLINE');
    expect(probe.kind).toBe('ollama');
    expect(probe.models).toContain('qwen-fixture');
    expect(probe.probedPath).toBe('/api/tags');
  });

  it('detects an OpenAI-compatible endpoint', async () => {
    behaviour = 'openai-ok';
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const probe = await probeEndpoint(baseUrl);
    expect(probe.kind).toBe('openai-compatible');
    expect(probe.effectiveBaseUrl).toBe(baseUrl);
  });

  it('finds an OpenAI-compatible server mounted under /v1', async () => {
    behaviour = 'openai-v1-ok';
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const probe = await probeEndpoint(baseUrl);
    expect(probe.kind).toBe('openai-compatible');
    expect(probe.effectiveBaseUrl).toBe(`${baseUrl}/v1`);
    expect(probe.probedPath).toBe('/v1/models');
  });

  it('reports NOT_CONFIGURED for an empty endpoint', async () => {
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    expect((await probeEndpoint('')).status).toBe('NOT_CONFIGURED');
  });

  it('reports OFFLINE when nothing is listening', async () => {
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const probe = await probeEndpoint('http://127.0.0.1:59998');
    expect(probe.status).toBe('OFFLINE');
    expect(probe.kind).toBeNull();
  });

  it('reports ERROR — not OFFLINE — when the key is rejected', async () => {
    behaviour = 'auth-error';
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const probe = await probeEndpoint(baseUrl, { apiKey: 'wrong' });
    expect(probe.status).toBe('ERROR');
    expect(probe.detail).toContain('401');
  });

  it('sends the API key as a bearer token when one is configured', async () => {
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    await probeEndpoint(baseUrl, { apiKey: 'secret-value' });
    expect(authHeaders[0]).toBe('Bearer secret-value');
  });
});

describe('model verification', () => {
  it('is ONLINE only after the model really answers', async () => {
    await configureRemote();
    const { verifyRole } = await import('@/core/providers/ai-health');
    const verification = await verifyRole('builder');
    expect(verification.status).toBe('ONLINE');
    expect(verification.sample).toContain('VISION-OK');
    expect(verification.reportedModel).toBe('qwen-fixture');
    expect(verification.latencyMs).not.toBeNull();
  });

  it('is ERROR when the server answers 200 with an empty completion', async () => {
    await configureRemote();
    behaviour = 'empty-completion';
    const { verifyRole } = await import('@/core/providers/ai-health');
    const verification = await verifyRole('builder');
    expect(verification.status).toBe('ERROR');
    expect(verification.detail).toContain('empty');
  });

  it('is ERROR when another model answers', async () => {
    await configureRemote();
    behaviour = 'wrong-model';
    const { verifyRole } = await import('@/core/providers/ai-health');
    const verification = await verifyRole('builder');
    expect(verification.status).toBe('ERROR');
    expect(verification.detail).toContain('some-other-model');
  });

  it('is ERROR when the model is not installed on the host', async () => {
    await configureRemote();
    behaviour = 'missing-model';
    const { verifyRole } = await import('@/core/providers/ai-health');
    const verification = await verifyRole('builder');
    expect(verification.status).toBe('ERROR');
    expect(verification.detail).toContain('not found');
  });

  it('is OFFLINE when the host stops answering', async () => {
    process.env.VISION_AI_BASE_URL = 'http://127.0.0.1:59997';
    process.env.VISION_QWEN_MODEL = 'qwen-fixture';
    const { verifyRole } = await import('@/core/providers/ai-health');
    const verification = await verifyRole('builder', { timeoutMs: 2_000 });
    expect(verification.status).toBe('OFFLINE');
  });

  it('accepts equivalent model ids but rejects different ones', async () => {
    const { modelsMatch } = await import('@/core/providers/ai-health');
    expect(modelsMatch('qwen2.5-coder:14b', 'qwen2.5-coder:14b')).toBe(true);
    expect(modelsMatch('qwen2.5-coder:14b', 'qwen2.5-coder:14b:latest')).toBe(true);
    expect(modelsMatch('qwen2.5-coder', '/models/qwen2.5-coder')).toBe(true);
    expect(modelsMatch('qwen2.5-coder', 'deepseek-r1')).toBe(false);
  });
});

describe('resilience', () => {
  it('retries a dropped connection with backoff and then succeeds', async () => {
    await configureRemote();
    behaviour = 'flaky-then-ok';
    const { getProvider } = await import('@/core/providers/registry');
    const { REMOTE_PROVIDER_ID } = await import('@/core/config/config');
    const provider = getProvider(REMOTE_PROVIDER_ID);
    const result = await provider.chat({
      model: 'qwen-fixture',
      messages: [{ role: 'user', content: 'ping' }],
      attempts: 4,
      timeoutMs: 5_000,
    });
    expect(result.content).toContain('VISION-OK');
    expect(requestCount).toBeGreaterThan(2);
  });

  it('does not retry a rejected key', async () => {
    await configureRemote();
    behaviour = 'auth-error';
    const { getProvider } = await import('@/core/providers/registry');
    const { REMOTE_PROVIDER_ID } = await import('@/core/config/config');
    const provider = getProvider(REMOTE_PROVIDER_ID);
    await expect(
      provider.chat({
        model: 'qwen-fixture',
        messages: [{ role: 'user', content: 'ping' }],
        attempts: 4,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow('401');
    expect(requestCount).toBe(1);
  });

  it('keeps the failure classification in diagnostics when the host is down', async () => {
    process.env.VISION_AI_BASE_URL = 'http://127.0.0.1:59993';
    process.env.VISION_QWEN_MODEL = 'qwen-fixture';
    process.env.VISION_DEEPSEEK_MODEL = 'deepseek-fixture';
    const { aiStatus } = await import('@/core/providers/ai-health');
    const status = await aiStatus({ verifyModels: false });
    expect(status.server.status).toBe('OFFLINE');
    expect(status.lastFailure?.kind).toBe('unreachable');
  });

  it('records the last failure for diagnostics', async () => {
    await configureRemote();
    behaviour = 'auth-error';
    const { verifyRole } = await import('@/core/providers/ai-health');
    const { lastFailure } = await import('@/core/providers/failure');
    const { REMOTE_PROVIDER_ID } = await import('@/core/config/config');
    await verifyRole('builder');
    const failure = lastFailure(REMOTE_PROVIDER_ID);
    expect(failure?.kind).toBe('auth');
    expect(failure?.status).toBe(401);
  });

  it('blocks a run before starting when no model is configured', async () => {
    // Endpoint present, model missing: the preflight can decide without a call.
    process.env.VISION_AI_BASE_URL = baseUrl;
    const { startJob } = await import('@/core/orchestrator/runner');
    const { getJob, eventsSince } = await import('@/core/orchestrator/job-store');
    const job = startJob({ prompt: 'do something', command: 'solve', mode: 'FAST' });
    expect(getJob(job.id)?.state).toBe('BLOCKED');
    const messages = eventsSince(job.id, 0)
      .filter((event) => event.type === 'job.error')
      .map((event) => (event.payload as { message: string }).message);
    expect(messages.join(' ')).toContain('GPU/MODEL UNAVAILABLE');
  });

  it('blocks — not fails — when the GPU stops answering mid-run', async () => {
    process.env.VISION_AI_BASE_URL = 'http://127.0.0.1:59996';
    process.env.VISION_QWEN_MODEL = 'qwen-fixture';
    process.env.VISION_DEEPSEEK_MODEL = 'deepseek-fixture';

    const { createJob, getJob } = await import('@/core/orchestrator/job-store');
    const { runOrchestration } = await import('@/core/orchestrator/orchestrator');
    const job = createJob({ projectId: 'p', mode: 'FAST', command: 'solve', prompt: 'add a helper' });
    const outcome = await runOrchestration({ job });

    expect(outcome.summary).toContain('GPU/MODEL UNAVAILABLE');
    expect(getJob(job.id)?.state).toBe('BLOCKED');
  });
});

describe('functional pipeline check', () => {
  it('verifies the builder → reviewer round trip end to end', async () => {
    await configureRemote();
    behaviour = 'council-ok';
    const { runPipelineCheck } = await import('@/core/providers/pipeline-check');
    const result = await runPipelineCheck();

    expect(result.stages.map((stage) => stage.name)).toEqual([
      'builder-reachable',
      'reviewer-reachable',
      'builder-task',
      'reviewer-review',
    ]);
    expect(result.ok).toBe(true);
    // The builder stage passes because the produced patch really contains the
    // requested function, not because the request returned 200.
    expect(result.stages[2]?.sample).toContain('addNumbers');
    expect(result.stages[2]?.detail).toContain('src/vision-selftest.ts');
    expect(result.stages[3]?.detail).toContain('APPROVED');
  });

  it('fails the builder stage when the answer is unusable', async () => {
    await configureRemote();
    // Every role replies 'VISION-OK', which is reachable but not a patch.
    behaviour = 'ollama-ok';
    const { runPipelineCheck } = await import('@/core/providers/pipeline-check');
    const result = await runPipelineCheck();

    expect(result.ok).toBe(false);
    expect(result.stages[0]?.status).toBe('ONLINE');
    expect(result.stages[2]?.status).toBe('ERROR');
  });

  it('stops at the reachability stages when no endpoint answers', async () => {
    // With no remote endpoint the roles fall back to a local Ollama, which is
    // not running here: the check must stop before claiming anything worked.
    const { runPipelineCheck } = await import('@/core/providers/pipeline-check');
    const result = await runPipelineCheck();
    expect(result.ok).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages.every((stage) => stage.status !== 'ONLINE')).toBe(true);
  });
});

describe('diagnostics', () => {
  it('masks the endpoint and never exposes the key', async () => {
    // A refused port keeps the probe instant while still exercising the path.
    process.env.VISION_AI_BASE_URL = 'http://127.0.0.1:59995/v1';
    process.env.VISION_QWEN_MODEL = 'qwen-fixture';
    process.env.VISION_DEEPSEEK_MODEL = 'deepseek-fixture';
    process.env.VISION_AI_API_KEY = 'super-secret-key';

    const { aiStatus } = await import('@/core/providers/ai-health');
    const status = await aiStatus({ verifyModels: false });
    const serialised = JSON.stringify(status);

    expect(serialised).not.toContain('super-secret-key');
    expect(status.provider.maskedEndpoint).toContain('***');
    expect(status.provider.maskedEndpoint).not.toContain('59995');
    expect(status.provider.apiKeyConfigured).toBe(true);
    expect(status.server.status).toBe('OFFLINE');
  });

  it('keeps the unreachable-host probe fast enough to poll', async () => {
    const { probeEndpoint } = await import('@/core/providers/endpoint-probe');
    const startedAt = Date.now();
    const probe = await probeEndpoint('http://127.0.0.1:59994');
    expect(probe.status).toBe('OFFLINE');
    // One refused connection, not one per candidate path.
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('masks credentials embedded in a URL', async () => {
    const { maskEndpoint } = await import('@/core/providers/http');
    const masked = maskEndpoint('https://user:password@gpu-host.example.com:8443/v1');
    expect(masked).not.toContain('password');
    expect(masked).not.toContain('user');
    expect(masked).not.toContain('8443');
  });

  it('reports judge readiness from the project, not from the models', async () => {
    const { judgeReadiness } = await import('@/core/providers/ai-health');
    const readiness = await judgeReadiness();
    expect(readiness.status).toBe('READY');
    expect(readiness.detail).toContain('test');
  });

  it('reports NOT_CONFIGURED for every role when no endpoint is set', async () => {
    const { aiStatus } = await import('@/core/providers/ai-health');
    const status = await aiStatus();
    expect(status.configured).toBe(false);
    expect(status.server.status).toBe('NOT_CONFIGURED');
    expect(status.roles.every((role) => role.status === 'NOT_CONFIGURED')).toBe(true);
  });
});
