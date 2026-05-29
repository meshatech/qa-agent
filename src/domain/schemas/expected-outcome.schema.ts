import { z } from 'zod';

export const ExpectedOutcomeKindSchema = z.enum([
  'AUTHENTICATION',
  'DEAUTHENTICATION',
  'NAVIGATION',
  'APPEARANCE_CHANGE',
  'DISCLOSURE',
  'CONTENT_PRESENCE',
  'DATA_ENTRY',
  'NO_REGRESSION',
]);

export const ExpectedOutcomeSchema = z
  .object({
    kind: ExpectedOutcomeKindSchema,
    target: z.string().min(1).optional(),
    description: z.string().min(1),
  })
  .strict();

export type ExpectedOutcomeKind = z.infer<typeof ExpectedOutcomeKindSchema>;
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export function createExpectedOutcome(input: {
  kind: ExpectedOutcomeKind;
  target?: string;
  description: string;
}): ExpectedOutcome {
  return ExpectedOutcomeSchema.parse(input);
}
