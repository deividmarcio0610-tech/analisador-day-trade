import { z } from 'zod';
import { handleError, ok, parseBody } from '../../_lib/http';
import { searchContent, replaceInFiles } from '@/core/tools/filesystem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const searchSchema = z.object({
  query: z.string().min(1),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  extensions: z.array(z.string()).optional(),
  maxMatches: z.number().int().min(1).max(2000).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, searchSchema);
    const matches = await searchContent(body.query, {
      regex: body.regex,
      caseSensitive: body.caseSensitive,
      extensions: body.extensions,
      maxMatches: body.maxMatches,
    });
    return ok({ matches, count: matches.length });
  } catch (error) {
    return handleError('api.fs.search', error);
  }
}

const replaceSchema = z.object({
  find: z.string().min(1),
  replace: z.string(),
  paths: z.array(z.string()).optional(),
  confirmed: z.literal(true),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, replaceSchema);
    const results = await replaceInFiles(body.find, body.replace, { paths: body.paths });
    return ok({
      files: results,
      totalReplacements: results.reduce((sum, result) => sum + result.replacements, 0),
    });
  } catch (error) {
    return handleError('api.fs.search', error);
  }
}
