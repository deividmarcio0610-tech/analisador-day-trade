import { gitDiff } from '@/core/tools/git';

/** Files with uncommitted changes — the natural focus set for /review. */
export async function gitDiffFocusFiles(): Promise<string[]> {
  const diff = await gitDiff({});
  if (!diff.available) return [];
  return diff.files.map((file) => file.path).slice(0, 30);
}
