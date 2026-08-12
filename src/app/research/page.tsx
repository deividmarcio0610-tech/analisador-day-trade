'use client';

import { ModeWorkspace } from '@/components/mode-workspace';

/** RESEARCH: deep read of the codebase, answered with file-level evidence. */
export default function ResearchPage() {
  return (
    <ModeWorkspace
      title="Research"
      description="Deep analysis over the real repository — the context engine selects files, imports, callers and tests."
      mode="DEEP_ANALYSIS"
      placeholder="Ask a question about this codebase…"
    />
  );
}
