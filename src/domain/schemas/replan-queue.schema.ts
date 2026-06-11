import { z } from 'zod';
import { ToolQueueItemSchema } from './tool-queue.schema.js';

export const ReplanActionSchema = z.enum([
  'replace_remaining_steps',
  'abort',
]);

export type ReplanAction = z.infer<typeof ReplanActionSchema>;

export const ReplanQueueSchema = z.object({
  action: ReplanActionSchema,
  fromStep: z.number().int().positive().optional(),
  taskQueue: z.array(ToolQueueItemSchema).optional(),
  reasoning: z.string().max(500),
}).refine(
  (data) => {
    if (data.action === 'replace_remaining_steps') {
      return data.fromStep !== undefined;
    }
    return true;
  },
  {
    message: 'fromStep is required when action is replace_remaining_steps',
    path: ['fromStep'],
  }
);

export type ReplanQueue = z.infer<typeof ReplanQueueSchema>;
