import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from '@/core/tools/filesystem';
import { workspaceRoot } from '@/core/paths';

/**
 * API CONTRACT GUARD
 *
 * Compares the API surface the backend actually exports with the endpoints the
 * frontend actually calls. Divergences (missing route, unused route, method
 * mismatch) are reported with the file and line that produced them.
 */

export interface RouteDefinition {
  endpoint: string;
  file: string;
  methods: string[];
}

export interface ClientCall {
  endpoint: string;
  file: string;
  line: number;
  method: string;
}

export interface ContractIssue {
  kind: 'missing-route' | 'method-not-exported' | 'unused-route';
  endpoint: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface ContractReport {
  routes: RouteDefinition[];
  calls: ClientCall[];
  issues: ContractIssue[];
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function isTestFile(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|fixtures?)\//.test(`/${filePath}`) || /\.(test|spec)\.[tj]sx?$/.test(filePath)
  );
}

export async function analyzeApiContract(root = workspaceRoot()): Promise<ContractReport> {
  const files = await walkFiles('.', { root, extensions: ['.ts', '.tsx'], maxFiles: 4_000 });

  const routes: RouteDefinition[] = [];
  const calls: ClientCall[] = [];

  for (const relative of files) {
    // Endpoint literals inside tests are fixtures, not calls the application makes.
    if (isTestFile(relative)) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }

    if (/(^|\/)route\.tsx?$/.test(relative) && relative.includes('/api/')) {
      routes.push({
        endpoint: endpointFromRouteFile(relative),
        file: relative,
        methods: HTTP_METHODS.filter((method) =>
          new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`).test(content),
        ),
      });
      continue;
    }

    calls.push(...findClientCalls(relative, content));
  }

  const issues: ContractIssue[] = [];
  for (const call of calls) {
    const route = routes.find((candidate) => matchesEndpoint(candidate.endpoint, call.endpoint));
    if (!route) {
      issues.push({
        kind: 'missing-route',
        endpoint: call.endpoint,
        detail: `called from ${call.file}:${call.line} but no route file exports it`,
        file: call.file,
        line: call.line,
      });
      continue;
    }
    if (route.methods.length > 0 && !route.methods.includes(call.method)) {
      issues.push({
        kind: 'method-not-exported',
        endpoint: call.endpoint,
        detail: `client uses ${call.method}, route exports ${route.methods.join(', ') || 'nothing'}`,
        file: call.file,
        line: call.line,
      });
    }
  }

  for (const route of routes) {
    const used = calls.some((call) => matchesEndpoint(route.endpoint, call.endpoint));
    if (!used) {
      issues.push({
        kind: 'unused-route',
        endpoint: route.endpoint,
        detail: 'no client call found for this route',
        file: route.file,
      });
    }
  }

  return { routes, calls, issues };
}

export function endpointFromRouteFile(relative: string): string {
  const withoutFile = relative.replace(/\/route\.tsx?$/, '');
  const apiIndex = withoutFile.indexOf('/api/');
  const tail = apiIndex >= 0 ? withoutFile.slice(apiIndex) : `/${withoutFile}`;
  // Route groups like (dashboard) are not part of the URL.
  return tail.replace(/\/\([^)]*\)/g, '');
}

/**
 * Matches an endpoint literal together with the call that carries it.
 *
 * Any call is accepted — `fetch`, `new EventSource`, a client wrapper
 * (`api.post<T>(…)`) or a project hook (`usePoll(…)`) — because real codebases
 * reach the API through their own helpers. The call prefix is mandatory, so a
 * bare path literal is not mistaken for a request.
 */
const CALL_PATTERN =
  /(?:\bnew\s+)?\b([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)\s*)?(?:<[^()]{0,300}>)?\s*\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g;

const WRAPPER_METHOD: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  del: 'DELETE',
  delete: 'DELETE',
};

/**
 * Scans the whole file rather than line by line: a call whose generic arguments
 * or options object wrap across lines is still one call.
 */
export function findClientCalls(file: string, content: string): ClientCall[] {
  const calls: ClientCall[] = [];
  const seen = new Set<string>();

  CALL_PATTERN.lastIndex = 0;
  let match = CALL_PATTERN.exec(content);
  while (match !== null) {
    const member = match[2];
    const raw = match[3] ?? match[4] ?? match[5] ?? '';
    const matchStart = match.index;
    const matchEnd = CALL_PATTERN.lastIndex;
    match = CALL_PATTERN.exec(content);

    if (!raw.startsWith('/api/')) continue;
    const endpoint = normalizeEndpoint(raw);
    // `/api/` alone is a path prefix test, not a request to an endpoint.
    if (endpoint.split('/').filter(Boolean).length < 2) continue;

    const line = content.slice(0, matchStart).split('\n').length;
    const key = `${endpoint}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const wrapper = member && member.toLowerCase() in WRAPPER_METHOD ? member : undefined;

    // `method:` in the options object wins; then the wrapper name; then GET.
    const rest = content.slice(matchEnd, matchEnd + 400);
    const methodMatch = /method\s*:\s*['"`]([A-Za-z]+)['"`]/.exec(rest);
    const method =
      methodMatch?.[1]?.toUpperCase() ??
      (wrapper ? WRAPPER_METHOD[wrapper.toLowerCase()] : undefined) ??
      'GET';

    calls.push({ endpoint, file, line, method });
  }
  return calls;
}

/** Strip query strings and collapse template placeholders into a wildcard. */
export function normalizeEndpoint(endpoint: string): string {
  const withoutQuery = endpoint.split('?')[0] ?? endpoint;
  return withoutQuery.replace(/\$\{[^}]*\}/g, '*').replace(/\/+$/, '') || '/';
}

/** Route endpoints may contain [param] segments; client endpoints may contain *. */
export function matchesEndpoint(routeEndpoint: string, callEndpoint: string): boolean {
  const routeParts = routeEndpoint.split('/').filter(Boolean);
  const callParts = callEndpoint.split('/').filter(Boolean);
  if (routeParts.length !== callParts.length) return false;
  return routeParts.every((part, index) => {
    const callPart = callParts[index];
    if (callPart === undefined) return false;
    if (part.startsWith('[') && part.endsWith(']')) return true;
    if (callPart === '*') return true;
    return part === callPart;
  });
}
