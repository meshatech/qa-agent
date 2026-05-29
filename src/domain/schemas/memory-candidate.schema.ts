import { z } from 'zod';

export const MemoryCandidateTypeSchema = z.enum([
  'locator',
  'flow',
  'known_issue',
  'scenario_result',
]);

export const MemoryCandidateStatusSchema = z.enum([
  'pending_review',
  'approved',
  'rejected',
]);

export const MemoryCandidateSchema = z
  .object({
    id: z.string().min(1),
    type: MemoryCandidateTypeSchema,
    title: z.string().min(1),
    content: z.string().min(1),
    sourceRunId: z.string().min(1),
    sourceScenarioId: z.string().optional(),
    sourceTaskId: z.string().optional(),
    sourceStepId: z.string().optional(),
    confidence: z.number().min(0).max(1),
    isConfirmed: z.boolean().default(false),
    status: MemoryCandidateStatusSchema.default('pending_review'),
    createdAt: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type MemoryCandidateType = z.infer<typeof MemoryCandidateTypeSchema>;
export type MemoryCandidateStatus = z.infer<typeof MemoryCandidateStatusSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export function createMemoryCandidate(input: {
  id: string;
  type: MemoryCandidateType;
  title: string;
  content: string;
  sourceRunId: string;
  sourceScenarioId?: string;
  sourceTaskId?: string;
  sourceStepId?: string;
  confidence: number;
  isConfirmed?: boolean;
  status?: MemoryCandidateStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): MemoryCandidate {
  return MemoryCandidateSchema.parse(input);
}
