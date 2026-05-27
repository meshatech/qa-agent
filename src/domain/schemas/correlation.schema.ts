import { z } from 'zod';

import { CorrelationItemSchema } from './correlation-item.schema.js';
import { RequiredScenarioSchema } from './required-scenario.schema.js';
import { RiskItemSchema } from './risk-item.schema.js';

export {
  CorrelationItemSchema,
  createCorrelationItem,
  type CorrelationItem,
} from './correlation-item.schema.js';

export {
  RiskItemSchema,
  RiskSeveritySchema,
  RiskTypeSchema,
  createRiskItem,
  type RiskItem,
  type RiskSeverity,
  type RiskType,
} from './risk-item.schema.js';

export {
  RequiredScenarioSchema,
  createRequiredScenario,
  type RequiredScenario,
} from './required-scenario.schema.js';

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
