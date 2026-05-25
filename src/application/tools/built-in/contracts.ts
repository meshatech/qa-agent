import { z } from 'zod';

import { LocatorDescriptorSchema, QaActionSchema, type QaAction } from '../../../domain/schemas/action.schema.js';
import { ExecutionPlanSchema, ExecutionStepSchema, PlanActionSchema, PlanConditionSchema, ReplanReasonSchema, RuntimeStateSnapshotSchema } from '../../../domain/schemas/execution-plan.schema.js';
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
  memoryContext: z.unknown().optional(),
  demandContext: z.unknown().optional(),
  screenObservation: ScreenObservationSchema.optional(),
  runtimeMode: z.string().optional(),
}).strict();

export const PlanReplanInputSchema = z.object({
  config: RunConfigSchema.optional(),
  plan: ExecutionPlanSchema.optional(),
  currentPlan: ExecutionPlanSchema.optional(),
  failedStep: ExecutionStepSchema,
  failedCondition: PlanConditionSchema.optional(),
  observation: ScreenObservationSchema.optional(),
  currentObservation: ScreenObservationSchema.optional(),
  reason: ReplanReasonSchema.optional(),
  replanReason: ReplanReasonSchema.optional(),
  message: z.string().min(1).optional(),
  executionContext: z.unknown().optional(),
  history: z.array(z.object({ stepId: z.string(), reason: z.string(), message: z.string() }).strict()).default([]),
  patchHistory: z.array(z.object({ stepId: z.string(), reason: z.string(), message: z.string() }).strict()).optional(),
  runData: z.record(z.string(), z.string()).default({}),
}).strict().refine((input) => input.plan || input.currentPlan, 'qa.plan.replan requires plan or currentPlan')
  .refine((input) => input.observation || input.currentObservation, 'qa.plan.replan requires observation or currentObservation')
  .refine((input) => input.reason || input.replanReason, 'qa.plan.replan requires reason or replanReason');

export const PlanExecuteInputSchema = z.object({
  config: RunConfigSchema.optional(),
  runConfig: RunConfigSchema.optional(),
  plan: ExecutionPlanSchema,
  scenarioId: z.string().min(1).optional(),
  outputConfig: z.unknown().optional(),
  planRef: z.object({
    runDir: z.string().min(1).optional(),
    planPath: z.string().min(1).optional(),
    planId: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

export const ReportGenerateInputSchema = z.object({
  runsDir: z.string().optional(),
  runId: z.string().optional(),
  format: z.enum(['md', 'json']).default('md'),
}).strict();

export const SpecExportInputSchema = z.object({
  executionLogPath: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
  sanitizeSensitiveData: z.boolean().default(true),
  outputPath: z.string().min(1).optional(),
  result: z.unknown().optional(),
}).strict().refine((input) => input.executionLogPath || input.result, 'qa.spec.export requires executionLogPath or result');

export const MemorySearchInputSchema = z.object({
  query: z.string().min(1),
  memoryPath: z.string().default('.agent-qa/memory.md'),
  limit: z.number().int().positive().max(20).default(5),
}).strict();

export const ConditionEvaluateInputSchema = z.object({
  condition: PlanConditionSchema,
  observation: ScreenObservationSchema.optional(),
  currentObservation: ScreenObservationSchema.optional(),
  before: RuntimeStateSnapshotSchema.optional(),
  beforeState: RuntimeStateSnapshotSchema.optional(),
  after: RuntimeStateSnapshotSchema.optional(),
  afterState: RuntimeStateSnapshotSchema.optional(),
  runContext: z.unknown().optional(),
}).strict().refine((input) => input.observation || input.currentObservation, 'qa.condition.evaluate requires observation or currentObservation');

export const ElementEnsureAvailableInputSchema = z.object({
  target: LocatorDescriptorSchema,
  observation: ScreenObservationSchema.optional(),
  currentObservation: ScreenObservationSchema.optional(),
  policy: z.unknown().optional(),
  availabilityPolicy: z.object({
    enabled: z.boolean(),
    maxOpenAttempts: z.number().int().nonnegative(),
    allowedContainers: z.array(z.object({
      semanticKey: z.string().min(1),
      openAction: PlanActionSchema,
      expectedState: PlanConditionSchema.optional(),
    }).strict()),
    allowGlobalEscape: z.boolean().optional(),
    allowClickOutside: z.boolean().optional(),
  }).strict().optional(),
  runContext: z.unknown().optional(),
  config: RunConfigSchema.optional(),
}).strict().refine((input) => input.observation || input.currentObservation, 'qa.element.ensureAvailable requires observation or currentObservation')
  .refine((input) => input.policy || input.availabilityPolicy, 'qa.element.ensureAvailable requires policy or availabilityPolicy');

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
  runId: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
  reason: z.string().min(1),
  status: z.enum(['PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'BLOCKED']).optional(),
  includeScreenshot: z.boolean().default(true),
  includeVideo: z.boolean().default(false),
  includeTrace: z.boolean().default(false),
  includeDomSnapshot: z.boolean().default(true),
  includeConsoleLog: z.boolean().default(true),
  includeNetworkLog: z.boolean().default(true),
  outputConfig: z.unknown().optional(),
  config: RunConfigSchema.optional(),
  evidence: z.record(z.string(), z.unknown()).default({}),
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
