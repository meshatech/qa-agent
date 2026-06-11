import { z } from 'zod';

export const QaValueMetricsSchema = z.object({
  estimatedManualMinutes: z.number().nonnegative(),
  agentExecutionMinutes: z.number().nonnegative(),
  estimatedMinutesSaved: z.number().nonnegative(),
  scenariosExecuted: z.number().int().nonnegative(),
  acceptanceCriteriaCovered: z.number().int().nonnegative(),
  acceptanceCriteriaTotal: z.number().int().nonnegative(),
  bugsFound: z.number().int().nonnegative(),
  evidenceFilesGenerated: z.number().int().nonnegative().optional(),
}).strict();

export type QaValueMetrics = z.infer<typeof QaValueMetricsSchema>;
