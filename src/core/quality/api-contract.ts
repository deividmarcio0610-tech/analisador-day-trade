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

export async function analyzeApiContract(root = workspaceRoot()): Promise<ContractReport> {
  const files = await walkFiles('.', { root, extensions: ['.ts', '.tsx'], maxFiles: 4_000 });

  const routes: RouteDefinition[] = [];
  const calls: ClientCall[] = [];

  for (const relative of files) {
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

const FETCH_PATTERN = /fetch\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")\s*(?:,\s*\{([^}]*)\})?/g;

export function findClientCalls(file: string, content: string): ClientCall[] {
  const calls: ClientCall[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    FETCH_PATTERN.lastIndex = 0;
    let match = FETCH_PATTERN.exec(line);
    while (match !== null) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      const options = match[4] ?? '';
      match = FETCH_PATTERN.exec(line);
      if (!raw.startsWith('/api/')) continue;
      const methodMatch = /method\s*:\s*['"`]([A-Za-z]+)['"`]/.exec(options);
      calls.push({
        endpoint: normalizeEndpoint(raw),
        file,
        line: index + 1,
        method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
      });
    }
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
