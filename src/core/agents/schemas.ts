import { z } from 'zod';

/** Wire schemas for agent output. Anything that fails validation is rejected. */

export const specRequirementSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  verification: z.string().default(''),
});

export const planSchema = z.object({
  summary: z.string().default(''),
  requirements: z.array(specRequirementSchema).default([]),
  steps: z
    .array(
      z.object({
        id: z.string().default(''),
        title: z.string().default(''),
        detail: z.string().default(''),
        files: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
});

export const patchSchema = z.object({
  summary: z.string().default(''),
  operations: z
    .array(
      z.object({
        path: z.string().min(1),
        action: z.enum(['create', 'update', 'delete']),
        content: z.string().optional(),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
  notes: z.array(z.string()).default([]),
});

export const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'APPROVED_WITH_COMMENTS', 'REJECTED']),
  findings: z
    .array(
      z.object({
        id: z.string().default(''),
        severity: z.enum(['blocker', 'major', 'minor', 'nit']).default('minor'),
        category: z
          .enum([
            'bug',
            'edge-case',
            'regression',
            'concurrency',
            'architecture',
            'performance',
            'inconsistency',
            'security',
          ])
          .default('bug'),
        file: z.string().optional(),
        summary: z.string().default(''),
        detail: z.string().default(''),
        suggestedTest: z.string().optional(),
      }),
    )
    .default([]),
});

export const debugSchema = z.object({
  observations: z.array(z.string()).default([]),
  hypotheses: z
    .array(
      z.object({
        id: z.string().default(''),
        statement: z.string().default(''),
        status: z
          .enum(['investigating', 'discarded', 'probable', 'confirmed'])
          .default('investigating'),
        evidence: z.string().default(''),
        nextCheck: z.string().default(''),
      }),
    )
    .default([]),
  rootCause: z.string().nullable().default(null),
  fixPlan: z.array(z.string()).default([]),
});

export const architectSchema = z.object({
  summary: z.string().default(''),
  sections: z
    .array(z.object({ title: z.string().default(''), content: z.string().default('') }))
    .default([]),
  requirements: z.array(specRequirementSchema).default([]),
  implementationOrder: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

export type PlanPayload = z.infer<typeof planSchema>;
export type PatchPayload = z.infer<typeof patchSchema>;
export type ReviewPayload = z.infer<typeof reviewSchema>;
export type DebugPayload = z.infer<typeof debugSchema>;
export type ArchitectPayload = z.infer<typeof architectSchema>;
