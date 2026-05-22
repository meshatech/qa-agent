import { z } from 'zod';

import { LocatorDescriptorSchema, QaActionSchema, type QaAction } from '../../../domain/schemas/action.schema.js';
import { ExecutionPlanSchema, PlanConditionSchema, RuntimeStateSnapshotSchema } from '../../../domain/schemas/execution-plan.schema.js';
import { RunConfigSchema, type RunConfig } from '../../../domain/schemas/config.schema.js';
import { ScreenObservationSchema } from '../../../domain/schemas/observation.schema.js';

export const ToolIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const ToolResultSchema = z.object({
  ok: z.boolean(),
  issues: z.array(ToolIssueSchema).default([]),
  result: z.unknown().optional(),
}).strict();

export const ScreenObserveInputSchema = z.object({
  includeDom: z.boolean().default(false),
  includeScreenshot: z.boolean().default(false),
  includeAccessibilityTree: z.boolean().default(false),
  includeUrl: z.boolean().default(true),
  includeConsoleSummary: z.boolean().default(false),
}).strict();

export const PlanBuildInputSchema = z.object({
  config: RunConfigSchema.optional(),
  scenarios: z.array(z.unknown()).default([]),
}).strict();

export const PlanReplanInputSchema = z.object({
  config: RunConfigSchema.optional(),
  plan: ExecutionPlanSchema,
  failedStep: z.unknown(),
  observation: ScreenObservationSchema,
  reason: z.string().min(1),
  message: z.string().min(1),
  history: z.array(z.object({ stepId: z.string(), reason: z.string(), message: z.string() }).strict()).default([]),
  runData: z.record(z.string(), z.string()).default({}),
}).strict();

export const PlanExecuteInputSchema = z.object({
  config: RunConfigSchema.optional(),
  plan: ExecutionPlanSchema,
}).strict();

export const ReportGenerateInputSchema = z.object({
  runsDir: z.string().optional(),
  runId: z.string().optional(),
  format: z.enum(['md', 'json']).default('md'),
}).strict();

export const SpecExportInputSchema = z.object({
  result: z.unknown(),
}).strict();

export const MemorySearchInputSchema = z.object({
  query: z.string().min(1),
  memoryPath: z.string().default('.agent-qa/memory.md'),
  limit: z.number().int().positive().max(20).default(5),
}).strict();

export const ConditionEvaluateInputSchema = z.object({
  condition: PlanConditionSchema,
  observation: ScreenObservationSchema,
  before: RuntimeStateSnapshotSchema.optional(),
  after: RuntimeStateSnapshotSchema.optional(),
}).strict();

export const ElementEnsureAvailableInputSchema = z.object({
  target: LocatorDescriptorSchema,
  observation: ScreenObservationSchema,
  policy: z.unknown(),
  config: RunConfigSchema.optional(),
}).strict();

export const LocatorResolveInputSchema = z.object({
  observation: ScreenObservationSchema,
  locator: LocatorDescriptorSchema,
}).strict();

export const ActionExecuteInternalInputSchema = z.object({
  action: QaActionSchema,
  config: RunConfigSchema.optional(),
  attempts: z.array(z.unknown()).default([]),
}).strict();

export const QuiescenceWaitInputSchema = z.object({
  timeoutMs: z.number().int().positive(),
}).strict();

export const EvidenceRecordInputSchema = z.object({
  runDir: z.string().optional(),
  evidence: z.unknown(),
}).strict();

export type ToolIssue = z.infer<typeof ToolIssueSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ScreenObserveInput = z.infer<typeof ScreenObserveInputSchema>;
export type PlanBuildInput = z.infer<typeof PlanBuildInputSchema>;
export type PlanReplanInput = z.infer<typeof PlanReplanInputSchema>;
export type PlanExecuteInput = z.infer<typeof PlanExecuteInputSchema>;
export type ReportGenerateInput = z.infer<typeof ReportGenerateInputSchema>;
export type SpecExportInput = z.infer<typeof SpecExportInputSchema>;
export type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>;
export type ConditionEvaluateInput = z.infer<typeof ConditionEvaluateInputSchema>;
export type ElementEnsureAvailableInput = z.infer<typeof ElementEnsureAvailableInputSchema>;
export type LocatorResolveInput = z.infer<typeof LocatorResolveInputSchema>;
export type ActionExecuteInternalInput = z.infer<typeof ActionExecuteInternalInputSchema>;
export type QuiescenceWaitInput = z.infer<typeof QuiescenceWaitInputSchema>;
export type EvidenceRecordInput = z.infer<typeof EvidenceRecordInputSchema>;

export interface BrowserToolService {
  observe(): Promise<unknown>;
  execute?(action: QaAction): Promise<unknown>;
  waitForQuiescence?(timeoutMs: number): Promise<unknown>;
  domSnapshot?(): Promise<string | undefined>;
  screenshot?(): Promise<Buffer | undefined>;
}

export interface ActionPolicyToolService {
  validate(action: QaAction, config: RunConfig, attempts: unknown[]): { ok: true } | { ok: false; code: string; message: string };
}
