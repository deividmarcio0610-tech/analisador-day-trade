'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvent, JobState } from '@/core/types';
import type {
  EvidenceItem,
  JudgeReport,
  PatchEventPayload,
  PlanPayloadView,
  ReviewPayload,
  TimelinePayload,
} from '@/lib/types';

/**
 * Consumes a job's Server-Sent Events stream.
 *
 * The stream replays everything already persisted before switching to live
 * updates, so mounting this hook at any time yields the complete history.
 */

const STAGES = ['context', 'analysis', 'planning', 'implementation', 'review', 'tests', 'validation'] as const;

export interface AgentStream {
  role: string;
  candidate?: string;
  text: string;
}

export interface JobStreamState {
  events: JobEvent[];
  timeline: TimelinePayload[];
  logs: Array<{ level: string; message: string; at: string }>;
  agents: AgentStream[];
  plan: PlanPayloadView | null;
  patches: PatchEventPayload[];
  reviews: ReviewPayload[];
  evidence: EvidenceItem[];
  judge: JudgeReport | null;
  state: JobState | null;
  error: string | null;
  connected: boolean;
  done: boolean;
}

const EMPTY: JobStreamState = {
  events: [],
  timeline: STAGES.map((stage) => ({ stage, state: 'pending' as const })),
  logs: [],
  agents: [],
  plan: null,
  patches: [],
  reviews: [],
  evidence: [],
  judge: null,
  state: null,
  error: null,
  connected: false,
  done: false,
};

export function useJobStream(jobId: string | null): JobStreamState {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setEvents([]);
    setDone(false);
    setConnected(false);
    if (!jobId) return;

    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    sourceRef.current = source;

    const push = (raw: MessageEvent<string>): void => {
      try {
        const event = JSON.parse(raw.data) as JobEvent;
        setEvents((previous) => [...previous, event]);
      } catch {
        // A malformed frame is dropped rather than corrupting the view.
      }
    };

    const types: string[] = [
      'job.created',
      'job.state',
      'log',
      'timeline',
      'agent.delta',
      'agent.message',
      'plan',
      'patch',
      'review',
      'judge',
      'evidence',
      'job.done',
      'job.error',
    ];
    for (const type of types) source.addEventListener(type, push as EventListener);

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('replay.done', () => setConnected(true));
    source.addEventListener('job.done', () => setDone(true));
    source.addEventListener('job.error', () => setDone(true));
    source.onerror = () => setConnected(false);

    return () => {
      for (const type of types) source.removeEventListener(type, push as EventListener);
      source.close();
      sourceRef.current = null;
    };
  }, [jobId]);

  return useMemo(() => reduce(events, connected, done), [events, connected, done]);
}

function reduce(events: JobEvent[], connected: boolean, done: boolean): JobStreamState {
  const state: JobStreamState = {
    ...EMPTY,
    timeline: STAGES.map((stage) => ({ stage, state: 'pending' as const })),
    events,
    connected,
    done,
    logs: [],
    agents: [],
    patches: [],
    reviews: [],
    evidence: [],
  };

  for (const event of events) {
    switch (event.type) {
      case 'timeline': {
        const payload = event.payload as TimelinePayload;
        const index = state.timeline.findIndex((entry) => entry.stage === payload.stage);
        if (index >= 0) state.timeline[index] = payload;
        else state.timeline.push(payload);
        break;
      }
      case 'log': {
        const payload = event.payload as { level: string; message: string };
        state.logs.push({ level: payload.level, message: payload.message, at: event.at });
        break;
      }
      case 'agent.delta': {
        const payload = event.payload as { role: string; candidate?: string; delta: string };
        const key = `${payload.role}:${payload.candidate ?? ''}`;
        const existing = state.agents.find((agent) => `${agent.role}:${agent.candidate ?? ''}` === key);
        if (existing) existing.text += payload.delta;
        else state.agents.push({ role: payload.role, candidate: payload.candidate, text: payload.delta });
        break;
      }
      case 'plan':
        state.plan = event.payload as PlanPayloadView;
        break;
      case 'patch':
        state.patches.push(event.payload as PatchEventPayload);
        break;
      case 'review':
        state.reviews.push(event.payload as ReviewPayload);
        break;
      case 'evidence':
        state.evidence.push(event.payload as EvidenceItem);
        break;
      case 'judge':
        state.judge = event.payload as JudgeReport;
        break;
      case 'job.state': {
        const payload = event.payload as { state: JobState; error: string | null };
        state.state = payload.state;
        if (payload.error) state.error = payload.error;
        break;
      }
      case 'job.error': {
        const payload = event.payload as { message: string };
        state.error = payload.message;
        break;
      }
      default:
        break;
    }
  }

  return state;
}
