import { z } from 'zod';
import { QaScenarioSchema } from './qa-scenario.schema.js';

export const SelectedScenariosArtifactSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  source: z.literal('scenario-orchestrator'),

  scenarios: z.array(QaScenarioSchema),
  selected: z.array(QaScenarioSchema),
  generated: z.array(QaScenarioSchema),
  uncoveredRequiredScenarios: z.array(z.string()),
  warnings: z.array(z.string()),

  summary: z.object({
    total: z.number().int().min(0),
    selected: z.number().int().min(0),
    generated: z.number().int().min(0),
    uncovered: z.number().int().min(0),
    truncated: z.boolean(),
    maxScenarios: z.number().int().min(1),
  }),
});

export type SelectedScenariosArtifact = z.infer<typeof SelectedScenariosArtifactSchema>;
