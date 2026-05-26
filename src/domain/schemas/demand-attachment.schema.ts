import { z } from 'zod';

export const DemandAttachmentSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    type: z.string().min(1),
  })
  .strict();

export type DemandAttachment = z.infer<typeof DemandAttachmentSchema>;
