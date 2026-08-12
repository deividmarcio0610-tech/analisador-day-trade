import { describe, expect, it } from 'vitest';
import { judge } from '@/core/agents/judge';
import type { EvidenceItem, ReviewResult } from '@/core/types';

const pass = (kind: EvidenceItem['kind']): EvidenceItem => ({
  kind,
  label: kind,
  verdict: 'PASS',
  summary: 'exit 0',
});

const fail = (kind: EvidenceItem['kind']): EvidenceItem => ({
  kind,
  label: kind,
  verdict: 'FAIL',
  summary: 'exit 1',
});

const approved: ReviewResult = { decision: 'APPROVED', findings: [], raw: '' };

describe('engineering judge', () => {
  it('never returns PASS without executed evidence', () => {
    expect(judge({ evidence: [] }).verdict).toBe('NOT_RUN');
    expect(
      judge({
        evidence: [{ kind: 'test', label: 'test', verdict: 'NOT_RUN', summary: 'no command' }],
      }).verdict,
    ).toBe('NOT_RUN');
  });

  it('returns PASS only when the required checks ran and passed', () => {
    const report = judge({ evidence: [pass('build'), pass('test')], review: approved });
    expect(report.verdict).toBe('PASS');
    expect(report.score).toBe(100);
  });

  it('does not pass when a required check is missing', () => {
    expect(judge({ evidence: [pass('lint')], required: ['build', 'test'] }).verdict).toBe('NOT_RUN');
  });

  it('fails when any check failed', () => {
    const report = judge({ evidence: [pass('build'), fail('test')] });
    expect(report.verdict).toBe('FAIL');
    expect(report.blockers.some((blocker) => blocker.includes('test'))).toBe(true);
  });

  it('a reviewer blocker overrides passing checks', () => {
    const review: ReviewResult = {
      decision: 'REJECTED',
      findings: [
        {
          id: 'F1',
          severity: 'blocker',
          category: 'bug',
          summary: 'off-by-one in the retry loop',
          detail: '',
        },
      ],
      raw: '',
    };
    const report = judge({ evidence: [pass('build'), pass('test')], review });
    expect(report.verdict).toBe('FAIL');
    expect(report.score).toBeLessThan(100);
  });

  it('a rejection with no blocker finding still fails', () => {
    const review: ReviewResult = { decision: 'REJECTED', findings: [], raw: '' };
    expect(judge({ evidence: [pass('build'), pass('test')], review }).verdict).toBe('FAIL');
  });

  it('BLOCKED evidence is a blocker, not a silent skip', () => {
    const report = judge({
      evidence: [{ kind: 'test', label: 'test', verdict: 'BLOCKED', summary: 'cancelled' }],
    });
    expect(report.verdict).toBe('FAIL');
  });
});
