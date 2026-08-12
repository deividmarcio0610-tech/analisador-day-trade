/**
 * Minimal line diff used to preview patches before they touch disk.
 *
 * Produces unified-diff text compatible with Monaco's diff viewer input and
 * with human reading. Large files fall back to a whole-file replacement block
 * because the quadratic LCS is not worth it there.
 */

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface UnifiedDiff {
  path: string;
  text: string;
  stats: DiffStats;
}

const MAX_LCS_LINES = 4000;

export function diffLines(oldText: string, newText: string): Array<{ type: ' ' | '-' | '+'; line: string }> {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n');
  const newLines = newText.length === 0 ? [] : newText.split('\n');

  if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) {
    return [
      ...oldLines.map((line) => ({ type: '-' as const, line })),
      ...newLines.map((line) => ({ type: '+' as const, line })),
    ];
  }

  const rows = oldLines.length;
  const cols = newLines.length;
  // table[i][j] = LCS length of oldLines[i:] and newLines[j:]
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const rowNext = table[i + 1];
      const row = table[i];
      if (!row || !rowNext) continue;
      row[j] =
        oldLines[i] === newLines[j]
          ? (rowNext[j + 1] ?? 0) + 1
          : Math.max(rowNext[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const out: Array<{ type: ' ' | '-' | '+'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: ' ', line: oldLines[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      out.push({ type: '-', line: oldLines[i] ?? '' });
      i += 1;
    } else {
      out.push({ type: '+', line: newLines[j] ?? '' });
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ type: '-', line: oldLines[i] ?? '' });
    i += 1;
  }
  while (j < cols) {
    out.push({ type: '+', line: newLines[j] ?? '' });
    j += 1;
  }
  return out;
}

export function unifiedDiff(
  path: string,
  oldText: string,
  newText: string,
  context = 3,
): UnifiedDiff {
  const changes = diffLines(oldText, newText);
  const stats: DiffStats = { additions: 0, deletions: 0 };
  for (const change of changes) {
    if (change.type === '+') stats.additions += 1;
    else if (change.type === '-') stats.deletions += 1;
  }

  if (stats.additions === 0 && stats.deletions === 0) {
    return { path, text: '', stats };
  }

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;

  while (index < changes.length) {
    const change = changes[index];
    if (!change) break;
    if (change.type === ' ') {
      index += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    // Walk back for leading context.
    let start = index;
    let leading = 0;
    while (start > 0 && leading < context && changes[start - 1]?.type === ' ') {
      start -= 1;
      leading += 1;
    }

    // Extend while changes keep appearing within 2*context.
    let end = index;
    let quiet = 0;
    while (end < changes.length && quiet <= context * 2) {
      const current = changes[end];
      if (!current) break;
      if (current.type === ' ') quiet += 1;
      else quiet = 0;
      end += 1;
    }
    const trailingTrim = Math.max(0, quiet - context);
    end -= trailingTrim;

    let hunkOldStart = oldLine - leading;
    let hunkNewStart = newLine - leading;
    if (hunkOldStart < 1) hunkOldStart = 1;
    if (hunkNewStart < 1) hunkNewStart = 1;

    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = start; k < end; k += 1) {
      const current = changes[k];
      if (!current) continue;
      body.push(`${current.type}${current.line}`);
      if (current.type !== '+') oldCount += 1;
      if (current.type !== '-') newCount += 1;
    }

    lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
    lines.push(...body);

    // Advance counters past the emitted hunk.
    for (let k = index; k < end; k += 1) {
      const current = changes[k];
      if (!current) continue;
      if (current.type !== '+') oldLine += 1;
      if (current.type !== '-') newLine += 1;
    }
    index = end;
  }

  return { path, text: lines.join('\n'), stats };
}
