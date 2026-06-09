import { z } from 'zod';

export const ProjectGraphNodeKindSchema = z.enum(['outcome', 'component', 'locator', 'alias']);
export type ProjectGraphNodeKind = z.infer<typeof ProjectGraphNodeKindSchema>;

export const ProjectGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: ProjectGraphNodeKindSchema,
  data: z.record(z.string(), z.unknown()).default({}),
  appUrlPattern: z.string().optional(),
  hits: z.number().int().nonnegative().default(0),
  misses: z.number().int().nonnegative().default(0),
  lastUsed: z.string().datetime({ message: 'Invalid datetime' }).optional(),
}).strict();

export type ProjectGraphNode = z.infer<typeof ProjectGraphNodeSchema>;

export const ProjectGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(['uses', 'validates', 'expects', 'belongs_to']),
}).strict();

export type ProjectGraphEdge = z.infer<typeof ProjectGraphEdgeSchema>;

export const ProjectGraphSchema = z.object({
  version: z.literal('graph.v1'),
  updatedAt: z.string().datetime({ message: 'Invalid datetime' }),
  nodes: z.array(ProjectGraphNodeSchema).default([]),
  edges: z.array(ProjectGraphEdgeSchema).default([]),
}).strict();

export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

export const ProjectGraphExperienceSchema = z.object({
  outcomeKind: z.string().min(1),
  validatedLocators: z.array(z.record(z.string(), z.unknown())).default([]),
  expectedStates: z.array(z.record(z.string(), z.unknown())).default([]),
  appUrlPattern: z.string().optional(),
  successCount: z.number().int().nonnegative().default(0),
  failureCount: z.number().int().nonnegative().default(0),
}).strict();

export type ProjectGraphExperience = z.infer<typeof ProjectGraphExperienceSchema>;
