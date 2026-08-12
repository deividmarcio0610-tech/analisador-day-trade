import { sseResponse } from '../../_lib/http';
import { processEvents, listRunningProcesses } from '@/core/tools/process-runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProcessDataEvent {
  processId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

/** Live stdout/stderr for every process started by the agent. */
export async function GET(): Promise<Response> {
  return sseResponse((send) => {
    const events = processEvents();
    send('snapshot', { processes: listRunningProcesses() });

    const onStart = (info: unknown) => send('start', info);
    const onData = (payload: ProcessDataEvent) => send('data', payload);
    const onEnd = (payload: unknown) => send('end', payload);

    events.on('start', onStart);
    events.on('data', onData);
    events.on('end', onEnd);

    return () => {
      events.off('start', onStart);
      events.off('data', onData);
      events.off('end', onEnd);
    };
  });
}
