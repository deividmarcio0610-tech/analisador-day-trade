import { z } from 'zod';
import { fail, handleError, ok, parseBody, searchParams } from '../../_lib/http';
import { readFile, writeFile, deleteFile } from '@/core/tools/filesystem';
import { unifiedDiff } from '@/core/util/diff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const target = searchParams(request).get('path');
    if (!target) return fail('path query parameter is required');
    return ok(await readFile(target));
  } catch (error) {
    return handleError('api.fs.file', error);
  }
}

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, writeSchema);
    const previous = await readFile(body.path).catch(() => null);
    const result = await writeFile(body.path, body.content);
    const diff = unifiedDiff(body.path, previous?.content ?? '', body.content);
    return ok({ ...result, diff: diff.text, stats: diff.stats });
  } catch (error) {
    return handleError('api.fs.file', error);
  }
}

const deleteSchema = z.object({ path: z.string().min(1), confirmed: z.literal(true) });

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, deleteSchema);
    await deleteFile(body.path);
    return ok({ deleted: body.path });
  } catch (error) {
    return handleError('api.fs.file', error);
  }
}
