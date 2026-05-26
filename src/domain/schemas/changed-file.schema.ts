import { z } from 'zod';

import { DiffLineSchema } from './diff-line.schema.js';

export const ChangedFileStatusSchema = z.enum(['modified', 'added', 'removed']);

export const ChangedFileSchema = z
  .object({
    path: z.string().min(1),
    status: ChangedFileStatusSchema,
    positiveLines: z.array(DiffLineSchema),
    negativeLines: z.array(DiffLineSchema),
    contextLines: z.array(DiffLineSchema),
  })
  .strict();

export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;
