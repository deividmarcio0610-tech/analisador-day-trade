import { describe, expect, it } from 'vitest';
import { maskSecret, scanTextForSecrets } from '@/core/quality/secret-guard';
import { isProseLine } from '@/core/quality/security-review';
import { estimateComplexity } from '@/core/quality/tech-debt';
import {
  endpointFromRouteFile,
  findClientCalls,
  matchesEndpoint,
  normalizeEndpoint,
} from '@/core/quality/api-contract';
import { parseTestOutput } from '@/core/tools/verification';
import { parseCommand, findCommand } from '@/core/commands/registry';
import { extractKeywords } from '@/core/context/context-engine';

describe('secret guard', () => {
  it('masks the matched value instead of returning it', () => {
    expect(maskSecret('supersecretvalue123')).not.toContain('secretvalue');
    expect(maskSecret('abc')).toBe('***');
  });

  it('detects a private key block and a connection string', () => {
    const findings = scanTextForSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nconst url = "postgres://user:hunter2@db:5432/app";',
      'config.ts',
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (const finding of findings) expect(finding.masked).not.toContain('hunter2');
  });

  it('does not flag environment variable references', () => {
    expect(scanTextForSecrets('const key = process.env.API_KEY;', 'a.ts')).toHaveLength(0);
  });

  it('does not flag a line that declares a detection pattern', () => {
    const line = "  { kind: 'GitHub token', pattern: /\\bghp_[A-Za-z0-9]{20,}\\b/, confidence: 'high' },";
    expect(scanTextForSecrets(line, 'src/core/quality/secret-guard.ts')).toHaveLength(0);
  });

  it('downgrades matches inside test fixtures to low confidence', () => {
    const fixture = 'const url = "postgres://user:hunter2@db:5432/app";';
    expect(scanTextForSecrets(fixture, 'src/lib/db.ts')[0]?.confidence).toBe('high');
    expect(scanTextForSecrets(fixture, 'tests/quality.test.ts')[0]?.confidence).toBe('low');
  });
});

describe('security review prose filter', () => {
  it('treats comments and descriptive fields as prose, not code', () => {
    expect(isProseLine('  // avoid dangerouslySetInnerHTML here')).toBe(true);
    expect(isProseLine("    detail: 'dangerouslySetInnerHTML bypasses React escaping.',")).toBe(true);
    expect(isProseLine('    pattern: /dangerouslySetInnerHTML/,')).toBe(true);
  });

  it('still treats real code as code', () => {
    expect(isProseLine('  return <div dangerouslySetInnerHTML={{ __html: value }} />;')).toBe(false);
  });
});

describe('technical debt heuristics', () => {
  it('reports functions with many branches', () => {
    const branches = Array.from({ length: 14 }, (_, index) => `  if (x === ${index}) return ${index};`).join('\n');
    const results = estimateComplexity('a.ts', `function big(x) {\n${branches}\n}\n`);
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe('big');
  });

  it('ignores simple functions', () => {
    expect(estimateComplexity('a.ts', 'function small(x) {\n  return x + 1;\n}\n')).toHaveLength(0);
  });
});

describe('api contract guard', () => {
  it('derives the endpoint from a route file path', () => {
    expect(endpointFromRouteFile('src/app/api/jobs/[id]/route.ts')).toBe('/api/jobs/[id]');
    expect(endpointFromRouteFile('src/app/(dash)/api/logs/route.ts')).toBe('/api/logs');
  });

  it('finds client calls with their method', () => {
    const calls = findClientCalls('page.tsx', `await fetch('/api/jobs', { method: 'POST', body });`);
    expect(calls[0]).toMatchObject({ endpoint: '/api/jobs', method: 'POST', line: 1 });
  });

  it('finds calls made through a client wrapper, including generic arguments', () => {
    expect(findClientCalls('page.tsx', `const data = await api.get<Thing>('/api/system');`)[0]).toMatchObject({
      endpoint: '/api/system',
      method: 'GET',
    });
    expect(
      findClientCalls('page.tsx', 'await api.post<{ status: string }>(`/api/vps/${id}`);')[0],
    ).toMatchObject({ endpoint: '/api/vps/*', method: 'POST' });
    expect(findClientCalls('page.tsx', `await api.post('/api/command', { input });`)[0]).toMatchObject({
      endpoint: '/api/command',
      method: 'POST',
    });
    expect(findClientCalls('page.tsx', `await api.del('/api/vps', { id });`)[0]).toMatchObject({
      endpoint: '/api/vps',
      method: 'DELETE',
    });
  });

  it('finds EventSource subscriptions', () => {
    expect(findClientCalls('p.tsx', "new EventSource('/api/terminal/stream')")[0]).toMatchObject({
      endpoint: '/api/terminal/stream',
      method: 'GET',
    });
  });

  it('ignores strings that are not endpoints', () => {
    expect(findClientCalls('p.tsx', `const label = 'not an endpoint';`)).toHaveLength(0);
  });

  it('ignores a bare path prefix test rather than reading it as a request', () => {
    expect(findClientCalls('code-graph.ts', `if (path.includes('/api/')) return 'api';`)).toHaveLength(0);
    expect(findClientCalls('impact.ts', `const routes = files.filter((f) => f.includes('/api/'));`)).toHaveLength(
      0,
    );
  });

  it('finds a call whose generic arguments wrap across lines', () => {
    const source = [
      'const verdict = await api.post<{',
      '  risk: CommandRisk;',
      '}>(',
      "  '/api/terminal/classify',",
      '  { commandLine },',
      ');',
    ].join('\n');
    expect(findClientCalls('terminal.tsx', source)[0]).toMatchObject({
      endpoint: '/api/terminal/classify',
      method: 'POST',
    });
  });

  it('finds endpoints reached through a project hook', () => {
    expect(
      findClientCalls('page.tsx', `const { data } = usePoll<SystemStatus>('/api/system', 15_000);`)[0],
    ).toMatchObject({ endpoint: '/api/system', method: 'GET' });
    expect(
      findClientCalls('page.tsx', `usePoll<Q>('/api/quality?scope=debt', 0)`)[0],
    ).toMatchObject({ endpoint: '/api/quality' });
  });

  it('normalises template placeholders and query strings', () => {
    expect(normalizeEndpoint('/api/jobs/${id}/stream?after=3')).toBe('/api/jobs/*/stream');
  });

  it('matches dynamic segments against concrete calls', () => {
    expect(matchesEndpoint('/api/jobs/[id]', '/api/jobs/*')).toBe(true);
    expect(matchesEndpoint('/api/jobs/[id]', '/api/jobs')).toBe(false);
    expect(matchesEndpoint('/api/jobs', '/api/patches')).toBe(false);
  });
});

describe('test output parsing', () => {
  it('parses a vitest summary', () => {
    expect(parseTestOutput('Tests  2 failed | 8 passed (10)')).toEqual({ failed: 2, passed: 8, total: 10 });
  });

  it('parses a jest summary', () => {
    expect(parseTestOutput('Tests:       1 failed, 4 passed, 5 total')).toEqual({
      failed: 1,
      passed: 4,
      total: 5,
    });
  });

  it('returns nulls when the format is unknown', () => {
    expect(parseTestOutput('everything is fine')).toEqual({ passed: null, failed: null, total: null });
  });
});

describe('command registry', () => {
  it('parses a slash command with an argument', () => {
    const parsed = parseCommand('/solve fix the login redirect');
    expect(parsed.command?.name).toBe('solve');
    expect(parsed.rest).toBe('fix the login redirect');
    expect(parsed.error).toBeNull();
  });

  it('rejects a command that needs an argument', () => {
    expect(parseCommand('/solve').error).toContain('needs an argument');
  });

  it('allows argument-free commands', () => {
    expect(parseCommand('/audit').error).toBeNull();
  });

  it('reports unknown commands', () => {
    expect(parseCommand('/nope something').error).toContain('Unknown command');
  });

  it('treats plain text as a free-form request', () => {
    const parsed = parseCommand('why is the build slow');
    expect(parsed.command).toBeNull();
    expect(parsed.error).toBeNull();
  });

  it('exposes every documented command', () => {
    for (const name of ['solve', 'debug', 'architect', 'prove', 'audit', 'gpu', 'vps', 'lab']) {
      expect(findCommand(name), name).not.toBeNull();
    }
  });
});

describe('context engine keyword selection', () => {
  it('prefers identifiers over prose', () => {
    const keywords = extractKeywords('the handleUserLogin function throws when session is empty');
    expect(keywords[0]).toBe('handleUserLogin');
  });

  it('drops stop words', () => {
    expect(extractKeywords('please fix this error')).not.toContain('please');
  });
});
