#!/usr/bin/env node
/**
 * Real validation of the remote GPU integration.
 *
 * Runs the whole checklist against a *running* Vision server and its configured
 * endpoint, then prints the report. Nothing here is simulated: every status,
 * model name and duration comes from a call that actually happened. When a value
 * cannot be obtained the report says so instead of filling it in.
 *
 *   npm run dev            # in one terminal
 *   npm run validate:ai    # in another
 *
 * Environment:
 *   VISION_URL          Vision server base URL (default http://127.0.0.1:3000)
 *   VALIDATE_TIMEOUT_MS How long to wait for the council run (default 900000)
 */

const BASE = (process.env.VISION_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const JOB_TIMEOUT_MS = Number(process.env.VALIDATE_TIMEOUT_MS ?? 900_000);

const TASK = 'Crie uma função TypeScript segura que receba dois números e retorne a soma.';

const report = {
  qwen: { status: 'UNKNOWN', model: null, provider: null, latencyMs: null, detail: '' },
  deepseek: { status: 'UNKNOWN', model: null, provider: null, latencyMs: null, detail: '' },
  team: 'NOT RUN',
  streaming: 'NOT RUN',
  failover: 'NOT RUN',
  build: 'NOT RUN',
  pending: [],
};

const step = (n, text) => console.log(`\n[${n}] ${text}`);
const line = (text) => console.log(`    ${text}`);

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
  }
  return { ok: response.ok, status: response.status, body };
}

function fmt(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Consume a job's SSE stream, separating replayed history from live frames. */
async function followJob(jobId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);
  const state = {
    deltasByRole: {},
    liveDeltas: 0,
    replayed: false,
    review: null,
    judge: null,
    patchFiles: [],
    error: null,
    finished: false,
  };

  try {
    const response = await fetch(`${BASE}/api/jobs/${jobId}/stream`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) throw new Error(`stream HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!state.finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');

        const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue;

        const type = eventLine.slice(7).trim();
        let payload;
        try {
          payload = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }

        if (type === 'replay.done') {
          state.replayed = true;
          continue;
        }
        const body = payload.payload ?? payload;

        if (type === 'agent.delta') {
          const role = body.role ?? 'unknown';
          state.deltasByRole[role] = (state.deltasByRole[role] ?? 0) + 1;
          if (state.replayed) state.liveDeltas += 1;
        } else if (type === 'review') {
          state.review = body;
        } else if (type === 'judge') {
          state.judge = body;
        } else if (type === 'patch') {
          state.patchFiles = (body.files ?? []).map((f) => f.path);
        } else if (type === 'job.error') {
          state.error = body.message;
        } else if (type === 'job.done' || type === 'job.error') {
          state.finished = true;
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') state.error = state.error ?? error.message;
    else state.error = state.error ?? `timed out after ${fmt(JOB_TIMEOUT_MS)}`;
  } finally {
    clearTimeout(timer);
  }
  return state;
}

async function main() {
  console.log(`VISION CODE — real AI validation against ${BASE}`);

  // ---- 0. Is the server up? ------------------------------------------------
  const system = await call('/api/system');
  if (!system.ok) {
    console.error(`\nCannot reach the Vision server at ${BASE}.`);
    console.error('Start it with `npm run dev` (or set VISION_URL) and run this again.');
    process.exit(2);
  }

  // ---- 1. Current provider configuration -----------------------------------
  step(1, 'Provider configuration');
  const settings = await call('/api/settings');
  const remote = settings.body?.remote ?? {};
  line(`endpoint      : ${remote.baseUrl || '<not set>'}  (source: ${remote.baseUrlSource ?? 'unset'})`);
  line(`builder model : ${remote.builderModel || '<not set>'}  (source: ${remote.builderModelSource ?? 'unset'})`);
  line(`reviewer model: ${remote.reviewerModel || '<not set>'}  (source: ${remote.reviewerModelSource ?? 'unset'})`);
  line(`timeout       : ${fmt(remote.timeoutMs)}`);
  line(`api key       : ${remote.apiKeyConfigured ? `${remote.apiKeyEnv} is set on the server` : 'not set (endpoint treated as open)'}`);

  const configured = Boolean(remote.baseUrl);
  if (!configured) {
    report.pending.push('VISION_AI_BASE_URL is not set — nothing to validate against');
  }

  // ---- 2/3. Endpoint probe and model listing --------------------------------
  step(2, 'Endpoint probe and model listing (real call)');
  const diag = await call('/api/ai/diagnostics');
  const ai = diag.body ?? {};
  line(`server        : ${ai.server?.status} — ${ai.server?.detail}`);
  line(`dialect       : ${ai.provider?.resolvedKind ?? 'not detected'}${ai.server?.probedPath ? ` on ${ai.server.probedPath}` : ''}`);
  line(`latency       : ${fmt(ai.server?.latencyMs)}`);
  const serverModels = ai.server?.models ?? [];
  line(`models served : ${serverModels.length ? serverModels.join(', ') : 'none reported'}`);
  if (ai.lastFailure) line(`last failure  : ${ai.lastFailure.kind} — ${ai.lastFailure.message}`);

  // ---- 4/5. Are the configured models actually on the server? ---------------
  step(3, 'Configured models present on the server');
  for (const [label, model] of [
    ['Qwen (builder)', remote.builderModel],
    ['DeepSeek (reviewer)', remote.reviewerModel],
  ]) {
    if (!model) {
      // Surface what the server offers so the id can be copied, never guessed.
      const candidates = serverModels.length
        ? ` — models on the server: ${serverModels.join(', ')}`
        : '';
      line(`${label}: NOT CONFIGURED${candidates}`);
      report.pending.push(`${label} has no model id configured`);
      continue;
    }
    if (serverModels.length === 0) {
      line(`${label}: cannot confirm — the server listed no models`);
      continue;
    }
    const present = serverModels.some((m) => m === model || m.startsWith(`${model}:`) || model.startsWith(m));
    line(`${label}: ${present ? 'present' : 'NOT FOUND on the server'} (${model})`);
    if (!present) report.pending.push(`Model "${model}" is not served by the endpoint`);
  }

  // ---- 6. Health check of both roles (real completions) ---------------------
  step(4, 'Health check — real completion per role');
  for (const role of ai.roles ?? []) {
    const target = role.role === 'builder' ? report.qwen : role.role === 'reviewer' ? report.deepseek : null;
    line(
      `${role.role.padEnd(9)}: ${role.status} · model ${role.model || '<none>'}` +
        `${role.reportedModel ? ` · answered as ${role.reportedModel}` : ''} · ${fmt(role.latencyMs)} · ${role.detail}`,
    );
    if (target) {
      target.status = role.status;
      target.model = role.model || null;
      target.provider = ai.provider?.id ?? null;
      target.latencyMs = role.latencyMs;
      target.detail = role.detail;
    }
  }

  const bothOnline = report.qwen.status === 'ONLINE' && report.deepseek.status === 'ONLINE';

  // ---- 7. Functional pipeline: builder → reviewer ---------------------------
  step(5, 'Functional pipeline check (builder → reviewer)');
  if (!bothOnline) {
    line('skipped — both roles must be ONLINE first');
  } else {
    const pipeline = await call('/api/ai/test', { method: 'POST' });
    for (const stage of pipeline.body?.stages ?? []) {
      line(`${stage.status.padEnd(15)} ${stage.label} — ${stage.detail} (${fmt(stage.durationMs)})`);
    }
    if (!pipeline.body?.ok) report.pending.push('Builder → reviewer round trip did not complete');
  }

  // ---- 8. TEAM MODE with the real task -------------------------------------
  step(6, 'TEAM MODE with the real task');
  line(`task: ${TASK}`);
  if (!bothOnline) {
    line('skipped — both roles must be ONLINE first');
  } else {
    const created = await call('/api/command', {
      method: 'POST',
      body: JSON.stringify({ input: TASK, mode: 'TEAM' }),
    });
    const job = created.body?.job;
    if (!job) {
      line(`could not start the run: ${created.body?.error ?? `HTTP ${created.status}`}`);
      report.team = 'FAIL';
      report.pending.push(`TEAM run could not start: ${created.body?.error ?? `HTTP ${created.status}`}`);
    } else {
      line(`job ${job.id} started — following the live stream…`);
      const stream = await followJob(job.id);
      const detail = await call(`/api/jobs/${job.id}`);
      const finished = detail.body?.job ?? {};
      const runs = detail.body?.runs ?? [];

      line(`state        : ${finished.state}${finished.error ? ` — ${finished.error}` : ''}`);
      for (const run of runs) {
        line(`call         : ${run.role.padEnd(9)} ${run.model} · ${fmt(run.durationMs)} · ${run.status}${run.error ? ` — ${run.error}` : ''}`);
      }
      line(`files changed: ${stream.patchFiles.join(', ') || 'none'}`);
      line(`review       : ${stream.review ? `${stream.review.decision} (${(stream.review.findings ?? []).length} finding(s))` : 'none'}`);
      line(`judge        : ${stream.judge ? `${stream.judge.verdict} (score ${stream.judge.score})` : 'none'}`);
      line(`stream deltas: ${JSON.stringify(stream.deltasByRole)} · ${stream.liveDeltas} arrived live`);
      if (stream.error) line(`error        : ${stream.error}`);

      // TEAM passes when the council really produced a patch and a review, and
      // the judge reached a verdict — not merely because HTTP answered.
      const producedPatch = stream.patchFiles.length > 0;
      const gotReview = Boolean(stream.review);
      const gotVerdict = Boolean(stream.judge);
      report.team = producedPatch && gotReview && gotVerdict ? 'PASS' : 'FAIL';
      if (report.team === 'FAIL') {
        report.pending.push(
          `TEAM run incomplete: patch=${producedPatch} review=${gotReview} verdict=${gotVerdict}`,
        );
      }

      // Streaming passes only on frames that arrived while the run was going.
      report.streaming = stream.liveDeltas > 0 ? 'PASS' : 'FAIL';
      if (report.streaming === 'FAIL') {
        report.pending.push('No streaming token arrived live during the run');
      }
    }
  }

  // ---- 9/10. Controlled failure and restore ---------------------------------
  step(7, 'Controlled failure: unreachable endpoint');
  const originalBaseUrl = remote.baseUrl ?? '';
  const originalSource = remote.baseUrlSource ?? 'unset';
  try {
    // Point at a port nothing listens on, then check the platform's reaction.
    await call('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ remote: { baseUrl: 'http://127.0.0.1:59599' } }),
    });
    const broken = await call('/api/ai/diagnostics?verify=false');
    const brokenStatus = broken.body?.server?.status;
    line(`endpoint status : ${brokenStatus} — ${broken.body?.server?.detail ?? ''}`);

    const stillAlive = await call('/api/quality?scope=debt');
    line(`app still serving: /api/quality -> HTTP ${stillAlive.status}`);

    const blockedRun = await call('/api/command', {
      method: 'POST',
      body: JSON.stringify({ input: 'validation probe', mode: 'FAST' }),
    });
    let blockedState = 'unknown';
    let blockedError = '';
    if (blockedRun.body?.job) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const after = await call(`/api/jobs/${blockedRun.body.job.id}`);
      blockedState = after.body?.job?.state ?? 'unknown';
      blockedError = after.body?.job?.error ?? '';
    }
    line(`council run     : ${blockedState}${blockedError ? ` — ${blockedError.slice(0, 90)}` : ''}`);

    const degradedCorrectly = brokenStatus === 'OFFLINE' || brokenStatus === 'ERROR';
    const appAlive = stillAlive.status === 200;
    const runBlocked = blockedState === 'BLOCKED' || blockedState === 'FAILED';
    report.failover = degradedCorrectly && appAlive && runBlocked ? 'PASS' : 'FAIL';
  } finally {
    // Always restore, even if a step above threw.
    await call('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ remote: { baseUrl: originalSource === 'settings' ? originalBaseUrl : '' } }),
    });
    const restored = await call('/api/settings');
    const now = restored.body?.remote?.baseUrl ?? '';
    line(`restored        : endpoint is ${now || '<not set>'} (source: ${restored.body?.remote?.baseUrlSource})`);
    if (now !== originalBaseUrl) {
      report.pending.push(`Endpoint was NOT restored correctly (now "${now}", was "${originalBaseUrl}")`);
    }
  }

  // ---- Report ---------------------------------------------------------------
  console.log('\n' + '='.repeat(58));
  console.log(`QWEN: ${report.qwen.status}`);
  console.log(`modelo: ${report.qwen.model ?? '<não configurado>'}${report.qwen.provider ? ` @ ${report.qwen.provider}` : ''}`);
  console.log(`latência: ${fmt(report.qwen.latencyMs)}`);
  console.log('');
  console.log(`DEEPSEEK: ${report.deepseek.status}`);
  console.log(`modelo: ${report.deepseek.model ?? '<não configurado>'}${report.deepseek.provider ? ` @ ${report.deepseek.provider}` : ''}`);
  console.log(`latência: ${fmt(report.deepseek.latencyMs)}`);
  console.log('');
  console.log(`TEAM MODE: ${report.team}`);
  console.log(`STREAMING: ${report.streaming}`);
  console.log(`FAILOVER: ${report.failover}`);
  console.log(`BUILD: ${report.build} (run \`npm run verify\` — this script does not build)`);
  console.log('');
  console.log('PENDÊNCIAS:');
  if (report.pending.length === 0) console.log('  nenhuma');
  else for (const item of report.pending) console.log(`  - ${item}`);
  console.log('='.repeat(58));

  const pass =
    bothOnline && report.team === 'PASS' && report.streaming === 'PASS' && report.failover === 'PASS';
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nValidation aborted: ${error.message}`);
  process.exit(2);
});
