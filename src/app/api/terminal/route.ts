import { z } from 'zod';
import { handleError, ok, parseBody } from '../_lib/http';
import { runCommand, listRunningProcesses, cancelProcess, listAuditLogs } from '@/core/tools/process-runner';
import { classifyCommand } from '@/core/safety/command-safety';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return ok({ processes: listRunningProcesses(), audit: listAuditLogs(50) });
  } catch (error) {
    return handleError('api.terminal', error);
  }
}

const runSchema = z.object({
  commandLine: z.string().min(1),
  cwd: z.string().optional(),
  confirmed: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
});

/** Execute a command and return the real result. CRITICAL commands need `confirmed`. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, runSchema);
    const classification = classifyCommand(body.commandLine);
    const result = await runCommand({
      commandLine: body.commandLine,
      cwd: body.cwd,
      confirmed: body.confirmed ?? false,
      timeoutMs: body.timeoutMs,
    });
    return ok({ ...result, risk: classification.risk, riskReasons: classification.reasons });
  } catch (error) {
    return handleError('api.terminal', error);
  }
}

const cancelSchema = z.object({ processId: z.string().min(1) });

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, cancelSchema);
    const cancelled = cancelProcess(body.processId);
    return ok({ cancelled, processId: body.processId });
  } catch (error) {
    return handleError('api.terminal', error);
  }
}
