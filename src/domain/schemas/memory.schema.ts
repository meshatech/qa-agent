import { z } from 'zod';

export const MemoryChunkTypeSchema = z.enum([
  'project',
  'route',
  'flow',
  'semantic_locator',
  'scenario',
  'known_issue',
  'runtime_learning',
]);

export const MemoryChunkSchema = z.object({
  id: z.string().min(1),
  type: MemoryChunkTypeSchema,
  title: z.string().min(1),
  content: z.string(),
  sourceFile: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const MemorySearchResultSchema = z.object({
  chunk: MemoryChunkSchema,
  relevanceScore: z.number(),
}).strict();

export const MemorySearchResponseSchema = z.object({
  chunks: z.array(MemorySearchResultSchema),
  warnings: z.array(z.string()),
}).strict();

export type MemoryChunkType = z.infer<typeof MemoryChunkTypeSchema>;
export type MemoryChunk = z.infer<typeof MemoryChunkSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;
