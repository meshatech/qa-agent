import { z } from 'zod';

export const CorrelationItemSchema = z
  .object({
    criterion: z.string().min(1),
    file: z.string().optional(),
    memoryChunk: z.string().optional(),
    score: z.number().min(0).max(1),
    rationale: z.string().min(1),
  })
  .strict();

export type CorrelationItem = z.infer<typeof CorrelationItemSchema>;

export function createCorrelationItem(input: {
  criterion: string;
  score: number;
  rationale: string;
  file?: string;
  memoryChunk?: string;
}): CorrelationItem {
  return CorrelationItemSchema.parse(input);
}
