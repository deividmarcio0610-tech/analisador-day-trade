import { describe, expect, it } from 'vitest';
import { extractJson, truncateMiddle, truncateTail } from '@/core/util/text';
import { diffLines, unifiedDiff } from '@/core/util/diff';

describe('model output parsing', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a fenced block with prose around it', () => {
    const raw = 'Sure, here is the patch:\n```json\n{"summary":"x","operations":[]}\n```\nHope it helps.';
    expect(extractJson<{ summary: string }>(raw)?.summary).toBe('x');
  });

  it('parses JSON that follows prose without a fence', () => {
    expect(extractJson<{ decision: string }>('Analysis done. {"decision":"REJECTED"}')).toEqual({
      decision: 'REJECTED',
    });
  });

  it('ignores braces inside strings when slicing', () => {
    const raw = 'text {"note":"a } brace","ok":true}';
    expect(extractJson<{ ok: boolean }>(raw)).toEqual({ note: 'a } brace', ok: true });
  });

  it('returns null when there is no JSON at all', () => {
    expect(extractJson('no structured output here')).toBeNull();
  });

  it('truncates keeping head and tail', () => {
    const text = 'a'.repeat(500);
    const result = truncateMiddle(text, 100);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('characters omitted');
    expect(truncateTail(text, 50)).toContain('characters omitted');
  });

  it('never exceeds the requested budget', () => {
    const text = 'x'.repeat(50_000);
    for (const budget of [0, 1, 10, 39, 79, 80, 200, 4000]) {
      expect(truncateMiddle(text, budget).length, `middle ${budget}`).toBeLessThanOrEqual(budget);
      expect(truncateTail(text, budget).length, `tail ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('returns short text unchanged', () => {
    expect(truncateMiddle('short', 100)).toBe('short');
    expect(truncateTail('short', 100)).toBe('short');
  });
});

describe('diff generation', () => {
  it('detects added and removed lines', () => {
    const changes = diffLines('a\nb\nc', 'a\nc\nd');
    expect(changes.filter((change) => change.type === '-').map((change) => change.line)).toEqual(['b']);
    expect(changes.filter((change) => change.type === '+').map((change) => change.line)).toEqual(['d']);
  });

  it('produces an empty diff for identical content', () => {
    const diff = unifiedDiff('a.ts', 'same\ncontent', 'same\ncontent');
    expect(diff.text).toBe('');
    expect(diff.stats).toEqual({ additions: 0, deletions: 0 });
  });

  it('produces a unified diff with hunk headers', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\nthree', 'one\nTWO\nthree');
    expect(diff.text).toContain('--- a/a.ts');
    expect(diff.text).toContain('+++ b/a.ts');
    expect(diff.text).toContain('@@');
    expect(diff.text).toContain('-two');
    expect(diff.text).toContain('+TWO');
    expect(diff.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it('treats file creation as all additions', () => {
    const diff = unifiedDiff('new.ts', '', 'line1\nline2');
    expect(diff.stats.additions).toBe(2);
    expect(diff.stats.deletions).toBe(0);
  });
});
