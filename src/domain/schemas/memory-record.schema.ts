import { createHash } from 'node:crypto';

import { z } from 'zod';

import { MemoryChunkTypeSchema } from './memory.schema.js';

export const PromotionStatusSchema = z.enum(['candidate', 'promoted', 'rejected', 'expired']);

export const ProjectScopeSchema = z.object({
  projectId: z.string().min(1),
  repoUrl: z.string().optional(),
  route: z.string().optional(),
  component: z.string().optional(),
});

export const PromotedMemoryRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repoUrl: z.string().optional(),
  type: MemoryChunkTypeSchema,
  title: z.string().min(1),
  content: z.string(),
  route: z.string().optional(),
  component: z.string().optional(),
  scenarioId: z.string().optional(),
  oldLocator: z.string().optional(),
  newLocator: z.string().optional(),
  failureSignature: z.string().optional(),
  evidenceUrl: z.string().optional(),
  confidence: z.number().min(0).max(1),
  promotionStatus: PromotionStatusSchema,
  sourceRunId: z.string().min(1),
  sourcePr: z.string().optional(),
  sourceCommitSha: z.string().optional(),
  contentHash: z.string().min(1),
});

export const FailureFingerprintSchema = z.object({
  projectId: z.string().min(1),
  failureSignature: z.string().min(1),
  route: z.string().optional(),
  component: z.string().optional(),
  brokenLocator: z.string().optional(),
  firstSeenRunId: z.string().min(1),
  lastSeenRunId: z.string().min(1),
  occurrences: z.number().int().nonnegative(),
  suggestedMemoryId: z.string().optional(),
});

export function mergeFailureFingerprint(
  existing: FailureFingerprint,
  input: RecordFailureFingerprintInput,
): FailureFingerprint {
  return {
    ...existing,
    occurrences: existing.occurrences + 1,
    lastSeenRunId: input.runId,
    suggestedMemoryId: input.suggestedMemoryId ?? existing.suggestedMemoryId,
  };
}

export function createFailureFingerprint(
  input: RecordFailureFingerprintInput,
): FailureFingerprint {
  return {
    projectId: input.projectId,
    failureSignature: input.failureSignature,
    route: input.route,
    component: input.component,
    brokenLocator: input.brokenLocator,
    firstSeenRunId: input.runId,
    lastSeenRunId: input.runId,
    occurrences: 1,
    suggestedMemoryId: input.suggestedMemoryId,
  };
}

export const RecordFailureFingerprintInputSchema = z.object({
  projectId: z.string().min(1),
  failureSignature: z.string().min(1),
  route: z.string().optional(),
  component: z.string().optional(),
  brokenLocator: z.string().optional(),
  runId: z.string().min(1),
  suggestedMemoryId: z.string().optional(),
});

export type ProjectScope = z.infer<typeof ProjectScopeSchema>;
export type PromotionStatus = z.infer<typeof PromotionStatusSchema>;
export type PromotedMemoryRecord = z.infer<typeof PromotedMemoryRecordSchema>;
export type FailureFingerprint = z.infer<typeof FailureFingerprintSchema>;
export type RecordFailureFingerprintInput = z.infer<typeof RecordFailureFingerprintInputSchema>;

export function computeContentHash(record: Pick<PromotedMemoryRecord, 'projectId' | 'type' | 'title' | 'content'>): string {
  return createHash('sha256').update(`${record.projectId}|${record.type}|${record.title}|${record.content}`).digest('hex');
}

export function computeFailureSignature(input: {
  projectId: string;
  errorType: string;
  route?: string;
  component?: string;
  brokenLocator?: string;
}): string {
  return createHash('sha256')
    .update(`${input.projectId}|${input.errorType}|${input.route ?? ''}|${input.component ?? ''}|${input.brokenLocator ?? ''}`)
    .digest('hex');
}
