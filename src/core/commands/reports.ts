import type { EvidenceItem, JudgeReport, Verdict } from '@/core/types';
import { eventsSince, getJob, listJobs } from '@/core/orchestrator/job-store';
import { listPatches } from '@/core/orchestrator/patch-service';
import { listTestRuns } from '@/core/tools/verification';
import { analyzeTechnicalDebt } from '@/core/quality/tech-debt';
import { analyzeApiContract } from '@/core/quality/api-contract';
import { runSecurityReview } from '@/core/quality/security-review';
import { detectStack } from '@/core/tools/stack-detect';
import { gitStatus } from '@/core/tools/git';

/**
 * /PROVE and /FINALIZE reports.
 *
 * Both assemble what actually happened. Any field with no observation behind it
 * says so explicitly instead of being filled with a plausible value.
 */

export interface ProveReport {
  jobId: string;
  problem: string;
  mode: string;
  rootCause: string | null;
  changedFiles: string[];
  reproducingTest: string | null;
  before: string | null;
  after: string | null;
  build: string;
  regression: string;
  evidence: EvidenceItem[];
  judge: JudgeReport | null;
  status: Verdict | 'UNKNOWN';
  notes: string[];
}

export function buildProveReport(jobId?: string): ProveReport | null {
  const job = jobId ? getJob(jobId) : listJobs(1)[0];
  if (!job) return null;

  const events = eventsSince(job.id, 0);
  const evidence: EvidenceItem[] = [];
  let judgeReport: JudgeReport | null = null;
  let rootCause: string | null = null;
  const notes: string[] = [];

  for (const event of events) {
    if (event.type === 'evidence') {
      evidence.push(event.payload as EvidenceItem);
    } else if (event.type === 'judge') {
      judgeReport = event.payload as JudgeReport;
    } else if (event.type === 'agent.message') {
      const payload = event.payload as { kind?: string; payload?: { rootCause?: string | null } };
      if (payload.kind === 'debug' && payload.payload?.rootCause) rootCause = payload.payload.rootCause;
    } else if (event.type === 'log') {
      const payload = event.payload as { level?: string; message?: string };
      if (payload.level === 'WARNING' && payload.message) notes.push(payload.message);
    }
  }

  const patches = listPatches(job.id);
  const changedFiles = [
    ...new Set(patches.flatMap((patch) => patch.operations.map((operation) => operation.path))),
  ];

  const runs = listTestRuns(50).filter((run) => run.taskId === job.id);
  const before = runs.length > 1 ? summariseRun(runs[runs.length - 1]) : null;
  const after = runs.length > 0 ? summariseRun(runs[0]) : null;

  const buildEvidence = evidence.find((item) => item.kind === 'build');
  const testEvidence = evidence.filter((item) => item.kind === 'test');

  return {
    jobId: job.id,
    problem: job.prompt,
    mode: job.mode,
    rootCause,
    changedFiles,
    reproducingTest: runs.length > 0 ? (runs[runs.length - 1]?.command ?? null) : null,
    before,
    after,
    build: buildEvidence ? `${buildEvidence.verdict} (${buildEvidence.summary})` : 'NOT RUN',
    regression:
      testEvidence.length > 0
        ? testEvidence.map((item) => `${item.label}: ${item.verdict}`).join(', ')
        : 'NOT RUN',
    evidence,
    judge: judgeReport,
    status: judgeReport?.verdict ?? 'UNKNOWN',
    notes,
  };
}

function summariseRun(run: ReturnType<typeof listTestRuns>[number] | undefined): string | null {
  if (!run) return null;
  return `${run.command} → exit ${run.exitCode ?? 'null'}${
    run.total !== null ? ` (${run.passed ?? 0}/${run.total} passed)` : ''
  } at ${run.createdAt}`;
}

export interface FinalizeReport {
  stack: Awaited<ReturnType<typeof detectStack>>;
  git: Awaited<ReturnType<typeof gitStatus>>;
  pendingMarkers: number;
  largeFiles: number;
  circularImports: number;
  orphanModules: number;
  contractIssues: number;
  securityFindings: number;
  highSeverityFindings: number;
  missingCommands: string[];
  blockers: string[];
  collectedAt: string;
}

/** Static half of /finalize. Executing checks is a separate, explicit action. */
export async function buildFinalizeReport(): Promise<FinalizeReport> {
  const [stack, git, debt, contract, security] = await Promise.all([
    detectStack(),
    gitStatus(),
    analyzeTechnicalDebt(),
    analyzeApiContract(),
    runSecurityReview(),
  ]);

  const missingCommands = Object.entries(stack.commands)
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  const highSeverity = security.findings.filter((finding) => finding.severity === 'high');
  const blockers: string[] = [];
  if (debt.circularImports.length > 0) {
    blockers.push(`${debt.circularImports.length} circular import chain(s)`);
  }
  if (contract.issues.some((issue) => issue.kind === 'missing-route')) {
    blockers.push('client calls an endpoint that has no route');
  }
  if (highSeverity.length > 0) blockers.push(`${highSeverity.length} high severity security finding(s)`);

  return {
    stack,
    git,
    pendingMarkers: debt.markers.length,
    largeFiles: debt.largeFiles.length,
    circularImports: debt.circularImports.length,
    orphanModules: debt.orphanModules.length,
    contractIssues: contract.issues.length,
    securityFindings: security.findings.length,
    highSeverityFindings: highSeverity.length,
    missingCommands,
    blockers,
    collectedAt: new Date().toISOString(),
  };
}
