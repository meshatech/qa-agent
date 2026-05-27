import { z } from 'zod';

export const ScenarioIntentSchema = z.enum(['POSITIVE', 'NEGATIVE', 'EDGE', 'EXPLORATORY']);

export type ScenarioIntent = z.infer<typeof ScenarioIntentSchema>;
