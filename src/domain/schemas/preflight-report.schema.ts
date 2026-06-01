import { z } from 'zod';

export const PREFLIGHT_CHECK_NAMES = [
  'clickupToken',
  'clickupReadAccess',
  'clickupTaskId',
  'githubToken',
  'prCommentPermission',
  'prContext',
  'branchHead',
  'checkoutHistory',
  'config',
] as const;

export type PreflightCheckName = (typeof PREFLIGHT_CHECK_NAMES)[number];

export const BLOCKING_PREFLIGHT_CHECKS = [
  'clickupToken',
  'clickupReadAccess',
  'clickupTaskId',
  'prContext',
  'branchHead',
  'checkoutHistory',
  'config',
] as const satisfies readonly PreflightCheckName[];

export const PreflightCheckStatusSchema = z.enum(['PASS', 'FAIL', 'WARN']);

export const PreflightCheckItemSchema = z.object({
  name: z.enum(PREFLIGHT_CHECK_NAMES),
  status: PreflightCheckStatusSchema,
  message: z.string(),
});

export const PreflightChecksDetailSchema = z.object({
  clickupToken: z.object({ ok: z.boolean() }),
  clickupReadAccess: z.object({
    ok: z.boolean(),
    statusCode: z.number().optional(),
    error: z.string().optional(),
  }),
  clickupTaskId: z.object({
    ok: z.boolean(),
    skipped: z.boolean().optional(),
    source: z.enum(['pr', 'config', 'env']).optional(),
    taskId: z.string().optional(),
    error: z.string().optional(),
    warning: z.string().optional(),
  }),
  githubToken: z.object({ ok: z.boolean(), warning: z.string().optional() }),
  prCommentPermission: z.object({
    ok: z.boolean(),
    statusCode: z.number().optional(),
    warning: z.string().optional(),
    repository: z.string().optional(),
    pullNumber: z.number().optional(),
  }),
  prContext: z.object({
    ok: z.boolean(),
    missing: z.array(z.string()),
    eventName: z.string().optional(),
  }),
  branchHead: z.object({
    ok: z.boolean(),
    branchHead: z.string().optional(),
    missing: z.array(z.string()),
  }),
  checkoutHistory: z.object({
    ok: z.boolean(),
    errors: z.array(z.string()),
    baseRef: z.string().optional(),
    shallow: z.boolean().optional(),
  }),
  config: z.object({
    ok: z.boolean(),
    errors: z.array(z.string()),
    configPath: z.string().optional(),
  }),
});

export const PreflightReportSchema = z.object({
  schemaVersion: z.literal('preflight-report.v1'),
  status: z.enum(['PASS', 'BLOCKED']),
  timestamp: z.string(),
  tokensMasked: z.boolean(),
  checkItems: z.array(PreflightCheckItemSchema).length(PREFLIGHT_CHECK_NAMES.length),
  checks: PreflightChecksDetailSchema,
});

export type PreflightCheckItem = z.infer<typeof PreflightCheckItemSchema>;
export type PreflightChecksDetail = z.infer<typeof PreflightChecksDetailSchema>;
export type PreflightReport = z.infer<typeof PreflightReportSchema>;
