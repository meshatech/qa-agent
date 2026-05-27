import { z } from 'zod';

export const DiffLineTypeSchema = z.enum(['added', 'removed', 'context']);

export const DiffLineSchema = z
  .object({
    type: DiffLineTypeSchema,
    lineNumber: z.number().int().positive(),
    content: z.string(),
  })
  .strict();

export type DiffLine = z.infer<typeof DiffLineSchema>;
export type DiffLineType = z.infer<typeof DiffLineTypeSchema>;
