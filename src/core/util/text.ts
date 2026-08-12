/** Text helpers shared by agents, tools and the API layer. */

/**
 * Truncate keeping head and tail, which is what matters in compiler/test output.
 * The result never exceeds `maxChars`, including for very small budgets.
 */
export function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (maxChars < 80) return text.slice(0, maxChars);

  const notice = (omitted: number): string => `\n... [${omitted} characters omitted] ...\n`;
  const half = Math.floor((maxChars - notice(text.length).length) / 2);
  if (half <= 0) return text.slice(0, maxChars);
  const omitted = text.length - half * 2;
  return `${text.slice(0, half)}${notice(omitted)}${text.slice(text.length - half)}`;
}

/** Keep the tail, which is where compiler and test failures are printed. */
export function truncateTail(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const notice = `... [${text.length - maxChars} characters omitted] ...\n`;
  const room = maxChars - notice.length;
  if (room <= 0) return text.slice(text.length - maxChars);
  return `${notice}${text.slice(text.length - room)}`;
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
 * Remove the reasoning block that thinking models (qwen3, deepseek-r1 and
 * friends) emit before their answer. It is stripped rather than parsed: it is
 * prose about the answer, and it routinely contains braces and code fragments
 * that would otherwise be mistaken for the structured output.
 *
 * An unterminated block is dropped to the end of the text, because that is what
 * a truncated reasoning stream looks like.
 */
export function stripReasoning(text: string): string {
  const closed = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
  const unterminated = closed.replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '');
  return unterminated.trim();
}

/**
 * Parse the first JSON object/array found in a model response.
 * Handles ```json fences, leading prose and reasoning blocks. Null on failure.
 */
export function extractJson<T>(text: string): T | null {
  const cleaned = stripReasoning(text);
  const fenced = extractFencedBlock(cleaned, 'json');
  const candidates = fenced ? [fenced, cleaned, text] : [cleaned, text];
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
