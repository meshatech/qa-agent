import { z } from 'zod';

import { DemandAttachmentSchema } from './demand-attachment.schema.js';

export const DemandContextSchema = z
  .object({
    taskId: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).default([]),
    attachments: z.array(DemandAttachmentSchema).default([]),
    status: z.string().min(1),
    assignees: z.array(z.string().min(1)).default([]),
    priority: z.string().nullable(),
    dueDate: z.string().datetime().nullable(),
  })
  .strict();

export type DemandContext = z.infer<typeof DemandContextSchema>;
