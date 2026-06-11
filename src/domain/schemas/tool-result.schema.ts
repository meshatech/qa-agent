import { z } from 'zod';

export const ToolResultSchema = z.object({
  ok: z.boolean(),
  tool: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
  evidence: z.array(z.object({
    kind: z.enum(['screenshot', 'log', 'observation']),
    path: z.string().optional(),
    summary: z.string().optional(),
  })).optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;
