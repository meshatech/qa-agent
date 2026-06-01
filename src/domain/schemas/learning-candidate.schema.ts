import { z } from 'zod';

export const LearningCandidateSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'semantic_locator',
    'route_mapping',
    'component_behavior',
    'recovery_pattern',
    'gap',
  ]),
  runId: z.string().min(1),
  scenarioId: z.string().optional(),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  description: z.string().min(1),
  content: z.string().min(1),
  source: z.enum(['confirmed', 'inferred']),
  confidence: z.number().min(0).max(1),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  metadata: z.object({
    locatorStrategy: z.string().optional(),
    elementId: z.string().optional(),
    semanticKey: z.string().optional(),
    hadTokenOverlap: z.boolean().optional(),
    hadReplan: z.boolean().optional(),
    hadDecide: z.boolean().optional(),
    hadElementAvailability: z.boolean().optional(),
    memoryGap: z.string().optional(),
  }).optional(),
  generatedAt: z.string().datetime(),
});

export const LearningCandidatesArtifactSchema = z.object({
  schemaVersion: z.literal('learning-candidates.v1').default('learning-candidates.v1'),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  count: z.number().int().nonnegative(),
  candidates: z.array(LearningCandidateSchema),
});

export type LearningCandidate = z.infer<typeof LearningCandidateSchema>;
export type LearningCandidatesArtifact = z.infer<typeof LearningCandidatesArtifactSchema>;
