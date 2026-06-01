import { z } from 'zod';
import { QaScenarioSchema } from './qa-scenario.schema.js';

export const SelectedScenariosSchema = z.object({
  schemaVersion: z.literal('selected-scenarios.v1'),
  generatedAt: z.string(),
  count: z.number().int().nonnegative(),
  scenarios: z.array(QaScenarioSchema),
}).strict();

export type SelectedScenarios = z.infer<typeof SelectedScenariosSchema>;
