import { z } from 'zod';
import { QaScenarioSchema } from './qa-scenario.schema.js';

export const ScenarioCatalogItemSourceSchema = z.enum(['memory', 'catalog', 'generated', 'manual']);
export const ScenarioCatalogItemPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const _ScenarioCatalogItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    route: z.string().optional(),
    component: z.string().optional(),
    criteria: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    priority: ScenarioCatalogItemPrioritySchema.optional(),
    source: ScenarioCatalogItemSourceSchema,
    memoryChunkId: z.string().optional(),
    scenario: QaScenarioSchema.optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

export type ScenarioCatalogItemInput = z.input<typeof _ScenarioCatalogItemSchema>;
export type ScenarioCatalogItemValidated = z.infer<typeof _ScenarioCatalogItemSchema>;

export function validateScenarioCatalogItem(input: unknown): ScenarioCatalogItemValidated {
  return _ScenarioCatalogItemSchema.parse(input);
}
