import type { EvidenceItem, JudgeReport, ReviewResult, Verdict } from '@/core/types';

/**
 * ENGINEERING JUDGE
 *
 * Deterministic on purpose. The verdict comes from executed checks, not from a
 * model's opinion: a claim of success that no command backs is worth nothing.
 * Reviewer findings can only make the verdict worse, never better.
 */

const WEIGHTS: Record<EvidenceItem['kind'], number> = {
  build: 30,
  test: 30,
  typecheck: 20,
  lint: 10,
  runtime: 5,
  static: 3,
  git: 2,
};

export interface JudgeInput {
  evidence: EvidenceItem[];
  review?: ReviewResult | null;
  /** Checks that must have run for a PASS verdict. */
  required?: Array<EvidenceItem['kind']>;
}

export function judge(input: JudgeInput): JudgeReport {
  const { evidence, review } = input;
  const required = input.required ?? ['build', 'test'];
  const blockers: string[] = [];
  const notes: string[] = [];

  for (const item of evidence) {
    if (item.verdict === 'FAIL') {
      blockers.push(`${item.label} failed (${item.summary})`);
    } else if (item.verdict === 'BLOCKED') {
      blockers.push(`${item.label} was blocked (${item.summary})`);
    } else if (item.verdict === 'NOT_RUN') {
      notes.push(`${item.label} did not run: ${item.summary}`);
    }
  }

  const reviewBlockers = (review?.findings ?? []).filter((finding) => finding.severity === 'blocker');
  for (const finding of reviewBlockers) {
    blockers.push(`review blocker: ${finding.summary}`);
  }
  if (review?.decision === 'REJECTED' && reviewBlockers.length === 0) {
    blockers.push('reviewer rejected the patch');
  }

  const executed = evidence.filter((item) => item.verdict === 'PASS' || item.verdict === 'FAIL');
  const missingRequired = required.filter(
    (kind) => !executed.some((item) => item.kind === kind),
  );

  let verdict: Verdict;
  if (blockers.length > 0) verdict = 'FAIL';
  else if (executed.length === 0) verdict = 'NOT_RUN';
  else if (missingRequired.length > 0) verdict = 'NOT_RUN';
  else verdict = 'PASS';

  for (const kind of missingRequired) {
    notes.push(`required check "${kind}" was not executed`);
  }

  return {
    verdict,
    score: score(evidence, review),
    evidence,
    blockers,
    notes,
    decidedAt: new Date().toISOString(),
  };
}

function score(evidence: EvidenceItem[], review?: ReviewResult | null): number {
  let earned = 0;
  let possible = 0;
  for (const item of evidence) {
    const weight = WEIGHTS[item.kind] ?? 1;
    if (item.verdict === 'NOT_RUN') continue;
    possible += weight;
    if (item.verdict === 'PASS') earned += weight;
  }
  if (possible === 0) return 0;

  let value = Math.round((earned / possible) * 100);
  for (const finding of review?.findings ?? []) {
    if (finding.severity === 'blocker') value -= 25;
    else if (finding.severity === 'major') value -= 10;
    else if (finding.severity === 'minor') value -= 3;
  }
  return Math.max(0, Math.min(100, value));
}

/** Human readable one-liner used in the timeline and in /prove reports. */
export function describeVerdict(report: JudgeReport): string {
  const counts = report.evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.verdict] = (acc[item.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([verdict, count]) => `${count} ${verdict}`);
  return `${report.verdict} (score ${report.score}) — ${parts.join(', ') || 'no checks'}`;
}
