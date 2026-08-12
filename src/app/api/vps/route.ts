import { z } from 'zod';
import { handleError, ok, parseBody } from '../_lib/http';
import { createConnection, deleteConnection, listConnections } from '@/core/tools/vps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return ok({ connections: listConnections() });
  } catch (error) {
    return handleError('api.vps', error);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1),
  authMethod: z.enum(['agent', 'key-file']),
  keyPath: z.string().nullable().optional(),
});

/**
 * Credentials are never accepted here: authentication uses the host ssh agent
 * or a key file that stays on the server.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, createSchema);
    return ok(createConnection(body));
  } catch (error) {
    return handleError('api.vps', error);
  }
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, deleteSchema);
    deleteConnection(body.id);
    return ok({ deleted: body.id });
  } catch (error) {
    return handleError('api.vps', error);
  }
}
