/** Response shapes shared between the API routes and the UI. */

import type {
  EvidenceItem,
  HealthStatus,
  Job,
  JobEvent,
  JudgeReport,
  Project,
  ReviewFinding,
  Verdict,
} from '@/core/types';

export type { EvidenceItem, Job, JobEvent, JudgeReport, ReviewFinding, Verdict, HealthStatus };

export interface ProviderStatusView {
  id: string;
  label: string;
  kind: string;
  baseUrl: string;
  enabled: boolean;
  health: { status: HealthStatus; latencyMs: number | null; detail: string; models?: string[] };
}

export interface AgentStatusView {
  role: string;
  label: string;
  providerId: string;
  model: string;
  online: HealthStatus;
}

export interface StackView {
  languages: string[];
  packageManager: string | null;
  testRunners: string[];
  commands: Record<string, string | null>;
}

export interface GitStatusView {
  available: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  files: Array<{ path: string; index: string; worktree: string; staged: boolean; untracked: boolean }>;
}

export interface ModelVerificationView {
  role: string;
  model: string;
  status: HealthStatus;
  latencyMs: number | null;
  detail: string;
  reportedModel: string | null;
  sample: string | null;
  checkedAt: string;
}

export interface AiStatusView {
  configured: boolean;
  provider: {
    id: string;
    label: string;
    kind: string;
    resolvedKind: string | null;
    maskedEndpoint: string;
    endpointConfigured: boolean;
    apiKeyEnv: string | null;
    apiKeyConfigured: boolean;
    timeoutMs: number;
  };
  server: {
    status: HealthStatus;
    detail: string;
    latencyMs: number | null;
    models: string[];
    probedPath: string | null;
  };
  roles: ModelVerificationView[];
  judge: { status: 'READY' | 'BLOCKED'; detail: string };
  lastFailure: { at: string; kind: string; status: number | null; message: string } | null;
  checkedAt: string;
}

export interface PipelineStageView {
  name: string;
  label: string;
  status: HealthStatus;
  detail: string;
  durationMs: number | null;
  model: string | null;
  reportedModel: string | null;
  sample: string | null;
}

export interface PipelineCheckView {
  ok: boolean;
  stages: PipelineStageView[];
  startedAt: string;
  finishedAt: string;
  taskId: string;
}

export interface RemoteSettingsShape {
  baseUrl: string;
  baseUrlSource: 'settings' | 'env' | 'unset';
  builderModel: string;
  builderModelSource: 'settings' | 'env' | 'unset';
  reviewerModel: string;
  reviewerModelSource: 'settings' | 'env' | 'unset';
  timeoutMs: number;
  apiKeyEnv: string;
  apiKeyConfigured: boolean;
  kind: string;
}

export interface SystemStatus {
  project: Project;
  workspaceRoot: string;
  ai: AiStatusView;
  providers: ProviderStatusView[];
  agents: AgentStatusView[];
  orchestrator: {
    maxRounds: number;
    defaultMode: string;
    autoApplyPatches: boolean;
    runTestsAutomatically: boolean;
  };
  stack: StackView;
  git: GitStatusView;
  processes: Array<{ id: string; commandLine: string; risk: string; startedAt: string }>;
  recentJobs: Job[];
  interruptedJobs: Job[];
  watchdog: { stalled: Array<{ jobId: string; state: string; idleMs: number }> };
  serverTime: string;
}

export interface FileNodeView {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface PatchFileView {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface PatchEventPayload {
  patchId: string;
  round?: number;
  candidate?: string;
  summary: string;
  notes?: string[];
  additions: number;
  deletions: number;
  files: PatchFileView[];
  impact?: string;
}

export interface TimelinePayload {
  stage: string;
  state: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail?: string | null;
  at?: string;
}

export interface ReviewPayload {
  round?: number;
  candidate?: string;
  decision: 'APPROVED' | 'APPROVED_WITH_COMMENTS' | 'REJECTED';
  findings: ReviewFinding[];
}

export interface PlanPayloadView {
  summary: string;
  requirements: Array<{ id: string; statement: string; verification: string }>;
  steps: Array<{ id: string; title: string; detail: string; files: string[] }>;
  risks: string[];
  sections?: Array<{ title: string; content: string }>;
}
