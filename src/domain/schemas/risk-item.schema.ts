import { z } from 'zod';

export const RiskSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const RiskTypeSchema = z.enum([
  'regression',
  'uncovered_criterion',
  'demand_diff_mismatch',
  'missing_memory',
  'dependency_change',
  'other',
]);

export const RiskItemSchema = z
  .object({
    severity: RiskSeveritySchema,
    description: z.string().min(1),
    relatedFile: z.string().optional(),
    type: RiskTypeSchema,
  })
  .strict();

export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;
export type RiskType = z.infer<typeof RiskTypeSchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;

export function createRiskItem(input: {
  severity: RiskSeverity;
  description: string;
  type: RiskType;
  relatedFile?: string;
}): RiskItem {
  return RiskItemSchema.parse(input);
}
