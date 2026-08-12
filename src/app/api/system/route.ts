import { handleError, ok } from '../_lib/http';
import { providerStatuses } from '@/core/providers/registry';
import { aiStatus } from '@/core/providers/ai-health';
import { getAgents, getOrchestratorConfig } from '@/core/config/config';
import { detectStack } from '@/core/tools/stack-detect';
import { gitStatus } from '@/core/tools/git';
import { workspaceRoot } from '@/core/paths';
import { currentProject } from '@/core/db/project-repo';
import { listRunningProcesses } from '@/core/tools/process-runner';
import { interruptedJobs, listJobs, reconcileOrphanJobs } from '@/core/orchestrator/job-store';
import { sweepStalledJobs } from '@/core/orchestrator/watchdog';
import { singleton } from '@/core/util/singleton';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Header/status feed: providers, agents, workspace, git and active work. */
export async function GET(): Promise<Response> {
  try {
    // First touch after a restart marks in-flight jobs INTERRUPTED (recoverable).
    singleton('orphan-reconcile', () => reconcileOrphanJobs());
    // The UI polls this endpoint, which is also when a stalled job is caught.
    const stalled = sweepStalledJobs();

    const project = currentProject();
    // The polled header only probes the endpoint; model completions are verified
    // on demand from Settings or the AI Council, not on every poll.
    const [providers, stack, git, ai] = await Promise.all([
      providerStatuses(),
      detectStack(),
      gitStatus(),
      aiStatus({ verifyModels: false }),
    ]);

    return ok({
      project,
      workspaceRoot: workspaceRoot(),
      ai,
      providers,
      agents: getAgents().map((agent) => ({
        role: agent.role,
        label: agent.label,
        providerId: agent.providerId,
        model: agent.model,
        online: providers.find((provider) => provider.id === agent.providerId)?.health.status ?? 'UNKNOWN',
      })),
      orchestrator: getOrchestratorConfig(),
      stack,
      git,
      processes: listRunningProcesses(),
      recentJobs: listJobs(10),
      interruptedJobs: interruptedJobs(10),
      watchdog: { stalled },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleError('api.system', error);
  }
}
