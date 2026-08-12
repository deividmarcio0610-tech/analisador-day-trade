/** Text helpers shared by agents, tools and the API layer. */

/** Truncate keeping head and tail, which is what matters in compiler/test output. */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 40) / 2);
  const omitted = text.length - half * 2;
  return `${text.slice(0, half)}\n... [${omitted} characters omitted] ...\n${text.slice(-half)}`;
}

export function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `... [${text.length - maxChars} characters omitted] ...\n${text.slice(-maxChars)}`;
}

/**
 * Extract the first fenced block whose info string matches `language`.
 * Returns null when absent — callers must not guess.
 */
export function extractFencedBlock(text: string, language: string): string | null {
  const fence = new RegExp('```' + language + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = fence.exec(text);
  return match && match[1] !== undefined ? match[1] : null;
}

/**
 * Parse the first JSON object/array found in a model response.
 * Handles ```json fences and leading prose. Returns null on failure.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = extractFencedBlock(text, 'json');
  const candidates = fenced ? [fenced, text] : [text];
  for (const candidate of candidates) {
    const direct = tryParse<T>(candidate.trim());
    if (direct !== null) return direct;
    const sliced = sliceBalanced(candidate);
    if (sliced) {
      const parsed = tryParse<T>(sliced);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function tryParse<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Find the first balanced {...} or [...] region, ignoring braces inside strings. */
function sliceBalanced(text: string): string | null {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  const candidates = [startObj, startArr].filter((index) => index >= 0);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  const open = text[start] === '{' ? '{' : '[';
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length;
}
