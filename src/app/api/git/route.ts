import { z } from 'zod';
import { handleError, ok, parseBody, searchParams } from '../_lib/http';
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitBranches,
  gitStashList,
  listCheckpoints,
  createCheckpoint,
  listWorktrees,
  restoreCheckpoint,
} from '@/core/tools/git';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = searchParams(request);
    const section = params.get('section') ?? 'all';
    const filePath = params.get('path') ?? undefined;

    if (section === 'diff') {
      return ok(await gitDiff({ path: filePath, staged: params.get('staged') === 'true' }));
    }
    if (section === 'log') return ok({ commits: await gitLog(Number(params.get('limit') ?? 30)) });
    if (section === 'status') return ok(await gitStatus());

    const [status, diff, commits, branches, stashes, checkpoints, worktrees] = await Promise.all([
      gitStatus(),
      gitDiff({}),
      gitLog(20),
      gitBranches(),
      gitStashList(),
      listCheckpoints(),
      listWorktrees(),
    ]);
    return ok({ status, diff, commits, branches, stashes, checkpoints, worktrees });
  } catch (error) {
    return handleError('api.git', error);
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('checkpoint'), label: z.string().min(1).max(60) }),
  z.object({ action: z.literal('restore'), tag: z.string().min(1), confirmed: z.literal(true) }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, actionSchema);
    if (body.action === 'checkpoint') {
      const checkpoint = await createCheckpoint(body.label);
      return ok({ checkpoint });
    }
    const result = await restoreCheckpoint(body.tag, { confirmed: true });
    return ok({ restored: body.tag, exitCode: result.exitCode, stderr: result.stderr });
  } catch (error) {
    return handleError('api.git', error);
  }
}
