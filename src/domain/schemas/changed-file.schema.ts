import { z } from 'zod';

import { DiffLineSchema } from './diff-line.schema.js';

export const ChangedFileStatusSchema = z.enum(['modified', 'added', 'removed']);

export const ChangedFileKindSchema = z.enum(['route', 'schema', 'test', 'infra', 'docs', 'other']);

export const ChangedFileWithoutKindSchema = z
  .object({
    path: z.string().min(1),
    status: ChangedFileStatusSchema,
    positiveLines: z.array(DiffLineSchema),
    negativeLines: z.array(DiffLineSchema),
    contextLines: z.array(DiffLineSchema),
  })
  .strict();

export const ChangedFileSchema = ChangedFileWithoutKindSchema.extend({
  kind: ChangedFileKindSchema,
}).strict();

export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type ChangedFileWithoutKind = z.infer<typeof ChangedFileWithoutKindSchema>;
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;
export type ChangedFileKind = z.infer<typeof ChangedFileKindSchema>;
