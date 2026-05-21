import { z } from 'zod';
import { ExecutionPlanSchema } from '../../../domain/schemas/execution-plan.schema.js';
import type { QaTool } from '../qa-tool.js';

export const PlanValidationToolInputSchema = z.object({
  plan: z.unknown(),
}).strict();

export const PlanValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const PlanValidationToolOutputSchema = z.object({
  ok: z.boolean(),
  issues: z.array(PlanValidationIssueSchema),
}).strict();

export type PlanValidationToolInput = z.infer<typeof PlanValidationToolInputSchema>;
export type PlanValidationToolOutput = z.infer<typeof PlanValidationToolOutputSchema>;

export const PlanValidationTool: QaTool<PlanValidationToolInput, PlanValidationToolOutput> = {
  name: 'qa.plan.validate',
  description: 'Validate an ExecutionPlan against the public Zod contract without executing browser actions.',
  inputSchema: PlanValidationToolInputSchema,
  outputSchema: PlanValidationToolOutputSchema,
  async execute(input) {
    const parsed = ExecutionPlanSchema.safeParse(input.plan);
    if (parsed.success) return { ok: true, issues: [] };
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.join('.') : '<root>',
        code: issue.code,
        message: issue.message,
      })),
    };
  },
};
