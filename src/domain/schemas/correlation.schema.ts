import { z } from 'zod';

import { CorrelationItemSchema } from './correlation-item.schema.js';
import { ScenarioIntentSchema } from './scenario-intent.schema.js';

export {
  CorrelationItemSchema,
  createCorrelationItem,
  type CorrelationItem,
} from './correlation-item.schema.js';

export const RiskSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const RiskTypeSchema = z.enum(['regression', 'uncovered_criterion', 'missing_memory', 'other']);

export const RiskItemSchema = z
  .object({
    severity: RiskSeveritySchema,
    description: z.string().min(1),
    relatedFile: z.string().optional(),
    type: RiskTypeSchema,
  })
  .strict();

export const RequiredScenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    intent: ScenarioIntentSchema,
    rationale: z.string().min(1),
    relatedFiles: z.array(z.string()),
    riskScore: z.number(),
  })
  .strict();

export const CorrelationStatusSchema = z.enum(['OK', 'BLOCKED']);

export const CorrelationResultSchema = z
  .object({
    schemaVersion: z.literal('correlation-result.v1'),
    status: CorrelationStatusSchema,
    blockReason: z.string().optional(),
    scenarios: z.array(RequiredScenarioSchema),
    correlations: z.array(CorrelationItemSchema),
    risks: z.array(RiskItemSchema),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;
export type RiskType = z.infer<typeof RiskTypeSchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;
export type RequiredScenario = z.infer<typeof RequiredScenarioSchema>;
export type CorrelationStatus = z.infer<typeof CorrelationStatusSchema>;
export type CorrelationResult = z.infer<typeof CorrelationResultSchema>;

export function createBlockedCorrelationResult(
  blockReason: string,
  warnings: string[] = [],
): CorrelationResult {
  return {
    schemaVersion: 'correlation-result.v1',
    status: 'BLOCKED',
    blockReason,
    scenarios: [],
    correlations: [],
    risks: [],
    warnings,
  };
}
