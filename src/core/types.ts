/**
 * Shared domain types for VISION CODE.
 *
 * These types are transport-neutral: they are used by the core engine, the HTTP
 * API layer and the web UI. Nothing here imports Node-only modules so the file
 * is safe to import from client components.
 */

export type AgentRole = 'planner' | 'builder' | 'reviewer' | 'judge';

export type ProviderKind = 'ollama' | 'vllm' | 'openai-compatible';

/**
 * Health of an external dependency. NOT_CONFIGURED is a first class state: the
 * product never pretends an integration exists when it has not been set up.
 */
export type HealthStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'NOT_CONFIGURED';

export interface HealthReport {
  status: HealthStatus;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  models?: string[];
}

/** Verdicts produced by the Engineering Judge, always backed by real evidence. */
export type Verdict = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';

export type RunMode =
  | 'FAST'
  | 'ENGINEER'
  | 'DEEP_ANALYSIS'
  | 'ARCHITECT'
  | 'DEBUG'
  | 'TEAM'
  | 'EXTREME';

export type JobState =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_REVIEW'
  | 'TESTING'
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

export type LogLevel =
  | 'INFO'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'DEBUG'
  | 'AGENT'
  | 'PROCESS';

/** Risk classification for shell commands. */
export type CommandRisk = 'SAFE' | 'REVIEW' | 'CRITICAL';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  sizeBytes?: number;
  family?: string;
}

/**
 * Abstract model provider. The UI never talks to Ollama/vLLM directly and never
 * references Qwen/DeepSeek by name — it asks for a role and the router resolves it.
 */
export interface ModelProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  health(signal?: AbortSignal): Promise<HealthReport>;
  models(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  chat(options: ChatOptions): Promise<ChatResult>;
  stream(options: ChatOptions): AsyncIterable<StreamChunk>;
}

export interface ProcessResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
  patch: string;
}

/** A concrete change proposal produced by the builder agent. */
export interface PatchOperation {
  path: string;
  action: 'create' | 'update' | 'delete';
  content?: string;
  rationale?: string;
}

export interface EvidenceItem {
  kind: 'lint' | 'typecheck' | 'test' | 'build' | 'runtime' | 'static' | 'git';
  label: string;
  verdict: Verdict;
  command?: string;
  exitCode?: number | null;
  summary: string;
  output?: string;
  durationMs?: number;
}

export interface JudgeReport {
  verdict: Verdict;
  score: number;
  evidence: EvidenceItem[];
  blockers: string[];
  notes: string[];
  decidedAt: string;
}

export interface ReviewFinding {
  id: string;
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  category:
    | 'bug'
    | 'edge-case'
    | 'regression'
    | 'concurrency'
    | 'architecture'
    | 'performance'
    | 'inconsistency'
    | 'security';
  file?: string;
  summary: string;
  detail: string;
  suggestedTest?: string;
}

export interface ReviewResult {
  decision: 'APPROVED' | 'REJECTED' | 'APPROVED_WITH_COMMENTS';
  findings: ReviewFinding[];
  raw: string;
}

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  files: string[];
}

export interface Plan {
  summary: string;
  requirements: SpecRequirement[];
  steps: PlanStep[];
  risks: string[];
  raw: string;
}

/** SPEC-FIRST: a verifiable requirement, e.g. AUTH-001. */
export interface SpecRequirement {
  id: string;
  statement: string;
  verification: string;
}

export type TimelineStage =
  | 'context'
  | 'analysis'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'tests'
  | 'validation';

export type TimelineState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface TimelineEntry {
  stage: TimelineStage;
  state: TimelineState;
  detail?: string;
  at?: string;
}

export type JobEventType =
  | 'job.created'
  | 'job.state'
  | 'log'
  | 'timeline'
  | 'agent.delta'
  | 'agent.message'
  | 'plan'
  | 'patch'
  | 'review'
  | 'judge'
  | 'evidence'
  | 'job.done'
  | 'job.error';

export interface JobEvent {
  id: number;
  jobId: string;
  type: JobEventType;
  at: string;
  /** Structured payload; shape depends on `type`. Serialised as JSON. */
  payload: unknown;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Job {
  id: string;
  projectId: string;
  mode: RunMode;
  command: string;
  prompt: string;
  state: JobState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface Project {
  id: string;
  name: string;
  root: string;
  createdAt: string;
  lastOpenedAt: string;
}
