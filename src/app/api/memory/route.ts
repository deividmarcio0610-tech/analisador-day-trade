import { z } from 'zod';
import { handleError, ok, parseBody, searchParams } from '../_lib/http';
import {
  listMemories,
  rememberMemory,
  deleteMemory,
  listFailures,
  recordFailure,
  listDecisions,
  recordDecision,
} from '@/core/memory/memory';
import { currentProject } from '@/core/db/project-repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MEMORY_KINDS = [
  'architecture',
  'convention',
  'decision',
  'problem',
  'solution',
  'component',
  'infrastructure',
  'test',
  'history',
] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const project = currentProject();
    const scope = searchParams(request).get('scope') ?? 'all';
    if (scope === 'memories') return ok({ memories: listMemories(project.id) });
    if (scope === 'failures') return ok({ failures: listFailures(project.id) });
    if (scope === 'decisions') return ok({ decisions: listDecisions(project.id) });
    return ok({
      project,
      memories: listMemories(project.id),
      failures: listFailures(project.id),
      decisions: listDecisions(project.id),
    });
  } catch (error) {
    return handleError('api.memory', error);
  }
}

const bodySchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('memory'),
    kind: z.enum(MEMORY_KINDS),
    title: z.string().min(1),
    body: z.string().min(1),
    tags: z.array(z.string()).optional(),
  }),
  z.object({
    scope: z.literal('failure'),
    problem: z.string().min(1),
    attempt: z.string().min(1),
    result: z.string().min(1),
    cause: z.string().min(1),
    validSolution: z.string().nullable().optional(),
    test: z.string().nullable().optional(),
  }),
  z.object({
    scope: z.literal('decision'),
    decision: z.string().min(1),
    alternatives: z.array(z.string()).default([]),
    reason: z.string().min(1),
    evidence: z.string().default(''),
    consequences: z.string().default(''),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const project = currentProject();
    const body = await parseBody(request, bodySchema);

    if (body.scope === 'memory') {
      return ok(
        rememberMemory({
          projectId: project.id,
          kind: body.kind,
          title: body.title,
          body: body.body,
          tags: body.tags,
        }),
      );
    }
    if (body.scope === 'failure') {
      return ok(
        recordFailure({
          projectId: project.id,
          problem: body.problem,
          attempt: body.attempt,
          result: body.result,
          cause: body.cause,
          validSolution: body.validSolution ?? null,
          test: body.test ?? null,
        }),
      );
    }
    return ok(
      recordDecision({
        projectId: project.id,
        decision: body.decision,
        alternatives: body.alternatives,
        reason: body.reason,
        evidence: body.evidence,
        consequences: body.consequences,
      }),
    );
  } catch (error) {
    return handleError('api.memory', error);
  }
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, deleteSchema);
    deleteMemory(body.id);
    return ok({ deleted: body.id });
  } catch (error) {
    return handleError('api.memory', error);
  }
}
