import { z } from 'zod';

export const MemoryChunkInfluenceSchema = z.enum([
  'scenario',
  'plan',
  'execution',
  'none',
]);

export const MemoryChunkConsultationSchema = z
  .object({
    chunkId: z.string().min(1),
    chunkType: z.string().min(1),
    chunkTitle: z.string().min(1),
    relevanceScore: z.number(),
    influence: MemoryChunkInfluenceSchema,
    rationale: z.string().optional(),
  })
  .strict();

export const MemoryGapSchema = z
  .object({
    description: z.string().min(1),
    criterion: z.string().optional(),
    affectedRoute: z.string().optional(),
  })
  .strict();

export const MemoryConsultationLogSchema = z
  .object({
    schemaVersion: z.literal('memory-consultation-log.v1'),
    query: z.string().min(1),
    totalChunksReturned: z.number().int().nonnegative(),
    chunks: z.array(MemoryChunkConsultationSchema),
    gaps: z.array(MemoryGapSchema),
    wroteNewLearning: z.literal(false),
    timestamp: z.string().min(1),
  })
  .strict();

export type MemoryChunkInfluence = z.infer<typeof MemoryChunkInfluenceSchema>;
export type MemoryChunkConsultation = z.infer<typeof MemoryChunkConsultationSchema>;
export type MemoryGap = z.infer<typeof MemoryGapSchema>;
export type MemoryConsultationLog = z.infer<typeof MemoryConsultationLogSchema>;

export function createMemoryConsultationLog(input: {
  query: string;
  totalChunksReturned: number;
  chunks: MemoryChunkConsultation[];
  gaps: MemoryGap[];
  timestamp: string;
}): MemoryConsultationLog {
  return MemoryConsultationLogSchema.parse({
    schemaVersion: 'memory-consultation-log.v1',
    wroteNewLearning: false,
    ...input,
  });
}
