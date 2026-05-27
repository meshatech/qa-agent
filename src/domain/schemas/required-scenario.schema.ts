import { z } from 'zod';

import { ScenarioIntentSchema, type ScenarioIntent } from './scenario-intent.schema.js';

export const RequiredScenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    intent: ScenarioIntentSchema,
    rationale: z.string().min(1),
    relatedFiles: z.array(z.string()),
    riskScore: z.number().min(0).max(1),
  })
  .strict();

export type RequiredScenario = z.infer<typeof RequiredScenarioSchema>;

export function createRequiredScenario(input: {
  id: string;
  title: string;
  intent: ScenarioIntent;
  rationale: string;
  relatedFiles: string[];
  riskScore: number;
}): RequiredScenario {
  return RequiredScenarioSchema.parse(input);
}
