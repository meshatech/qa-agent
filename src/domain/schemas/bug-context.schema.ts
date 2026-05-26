import { z } from 'zod';

export const BugContextSchema = z
  .object({
    reproductionSteps: z.array(z.string().min(1)).default([]),
    expectedResult: z.string().nullable(),
    actualResult: z.string().nullable(),
  })
  .strict();

export type BugContext = z.infer<typeof BugContextSchema>;
