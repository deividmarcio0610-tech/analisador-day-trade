import { handleError, ok, searchParams } from '../_lib/http';
import { analyzeTechnicalDebt } from '@/core/quality/tech-debt';
import { runSecurityReview } from '@/core/quality/security-review';
import { analyzeApiContract } from '@/core/quality/api-contract';
import { projectHealth } from '@/core/quality/project-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Static quality engines. `scope=all` runs every one of them. */
export async function GET(request: Request): Promise<Response> {
  try {
    const scope = searchParams(request).get('scope') ?? 'all';

    if (scope === 'debt') return ok({ debt: await analyzeTechnicalDebt() });
    if (scope === 'security') return ok({ security: await runSecurityReview() });
    if (scope === 'contract') return ok({ contract: await analyzeApiContract() });
    if (scope === 'health') return ok({ health: await projectHealth() });

    const [debt, security, contract, health] = await Promise.all([
      analyzeTechnicalDebt(),
      runSecurityReview(),
      analyzeApiContract(),
      projectHealth(),
    ]);
    return ok({ debt, security, contract, health });
  } catch (error) {
    return handleError('api.quality', error);
  }
}
