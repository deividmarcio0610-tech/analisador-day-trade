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
 * Health of an external dependency. Each state means something different and
 * the product never collapses them:
 *
 * - `ONLINE`         verified end to end (reachable *and* it answered correctly)
 * - `OFFLINE`        unreachable: refused, timed out, DNS failure
 * - `ERROR`          reachable but wrong: auth rejected, model missing, bad answer
 * - `NOT_CONFIGURED` nothing was set up to reach in the first place
 * - `UNKNOWN`        not checked yet
 */
export type HealthStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN' | 'NOT_CONFIGURED';

export interface HealthReport {
  status: HealthStatus;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  models?: string[];
}

/**
 * Verification of a single model: an actual completion was requested and the
 * answer was inspected. `ONLINE` here means the model replied with usable
 * content, not merely that the HTTP call returned 200.
 */
export interface ModelVerification {
  role: AgentRole;
  model: string;
  status: HealthStatus;
  latencyMs: number | null;
  detail: string;
  /** Model id echoed by the server, when it reports one. */
  reportedModel: string | null;
  /** First characters of the answer, for evidence that it really replied. */
  sample: string | null;
  checkedAt: string;
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
  | 'BLOCKED'
  /** The process died mid-run. The work is not lost and the job can be resumed. */
  | 'INTERRUPTED';

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
  /** Overrides the provider's configured timeout (health probes use a short one). */
  timeoutMs?: number;
  /** Attempts for retryable failures; the provider applies exponential backoff. */
  attempts?: number;
}

export interface ChatResult {
  content: string;
  /** Model that was requested. */
  model: string;
  /** Model the server says it used, when it reports one. Never assumed. */
  reportedModel: string | null;
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
