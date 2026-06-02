import { z } from 'zod';
import { LocatorDescriptorSchema } from './action.schema.js';

export const RuntimeModeSchema = z.enum(['HYBRID_GUARDED', 'FULL_REACTIVE', 'PLAN_AND_EXECUTE']);
export const StepFailurePolicySchema = z.enum(['ASK_LLM_TO_REPLAN', 'RECOVER', 'BLOCK', 'CONTINUE_WITH_WARNING']);
export const DestructiveActionPolicySchema = z.enum(['ALLOW', 'BLOCK', 'ASK_APPROVAL', 'ALLOW_ONLY_IN_TEST_ENV']);
export const ReplanReasonSchema = z.enum([
  'PRECONDITION_FAILED',
  'POSTCONDITION_FAILED',
  'LOCATOR_NOT_FOUND',
  'RECOVERY_FAILED',
  'UNEXPECTED_ROUTE',
  'MODAL_OR_OVERLAY_DETECTED',
  'ASSERTION_FAILED',
]);

const reason = z.string().min(1);
const runtimeExpected = z.union([z.string(), z.boolean(), z.number(), z.enum(['changed', 'unchanged', 'exists', 'not_exists', 'open', 'closed', 'authenticated', 'anonymous', 'same', 'matches'])]);

export const RuntimeStateSnapshotSchema = z.object({
  observationId: z.string(),
  url: z.string(),
  semanticStates: z.record(z.string(), z.unknown()).default({}),
  attributes: z.record(z.string(), z.unknown()).default({}),
  storage: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string(),
}).strict();

export const PlanConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field_value_contains'), target: LocatorDescriptorSchema, value: z.string() }).strict(),
  z.object({ type: z.literal('element_visible'), target: LocatorDescriptorSchema.optional(), text: z.string().optional() }).strict().refine((a) => a.target || a.text, 'element_visible requires target or text'),
  z.object({ type: z.literal('text_visible'), text: z.string() }).strict(),
  z.object({ type: z.literal('text_any_visible'), texts: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ type: z.literal('url_contains'), value: z.string() }).strict(),
  z.object({ type: z.literal('no_console_errors') }).strict(),
  z.object({ type: z.literal('ui_state'), semanticKey: z.string().min(1), expected: runtimeExpected, source: z.enum(['dom', 'attribute', 'computed_style', 'storage', 'url', 'accessibility', 'custom']).optional(), selectorHint: z.string().optional(), attribute: z.string().optional() }).strict(),
  z.object({ type: z.literal('auth_state'), expected: z.enum(['authenticated', 'anonymous', 'changed']) }).strict(),
  z.object({ type: z.literal('menu_state'), semanticKey: z.string().min(1), expected: z.enum(['open', 'closed', 'changed']) }).strict(),
  z.object({ type: z.literal('route_state'), expected: z.enum(['changed', 'same', 'matches']), expectedUrl: z.string().optional(), expectedUrlPattern: z.string().optional() }).strict(),
  z.object({ type: z.literal('attribute_state'), target: LocatorDescriptorSchema, attribute: z.string().min(1), expected: z.union([z.string(), z.boolean(), z.enum(['changed', 'exists', 'not_exists'])]) }).strict(),
  z.object({ type: z.literal('storage_state'), storage: z.enum(['localStorage', 'sessionStorage']), key: z.string().min(1), expected: z.union([z.string(), z.boolean(), z.enum(['changed', 'exists', 'not_exists'])]) }).strict(),
  z.object({ type: z.literal('network_state'), expected: z.enum(['no_errors', 'no_4xx', 'no_5xx', 'has_request_to']), urlPattern: z.string().optional(), minStatus: z.number().int().min(100).max(599).optional(), maxStatus: z.number().int().min(100).max(599).optional() }).strict(),
]);

export const PreconditionSchema = PlanConditionSchema;
export const PostconditionSchema = PlanConditionSchema;
export const BusinessAssertionSchema = PlanConditionSchema;

export const PlanActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), target: LocatorDescriptorSchema, reason }).strict(),
  z.object({ type: z.literal('fill'), target: LocatorDescriptorSchema, value: z.string(), reason }).strict(),
  z.object({ type: z.literal('select'), target: LocatorDescriptorSchema, option: z.union([z.object({ label: z.string() }), z.object({ value: z.string() }), z.object({ index: z.number().int().nonnegative() })]), reason }).strict(),
  z.object({ type: z.literal('press'), key: z.enum(['Escape', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']), target: LocatorDescriptorSchema.optional(), reason }).strict(),
  z.object({ type: z.literal('clickOutside'), reason }).strict(),
  z.object({ type: z.literal('clickAtCoordinates'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), reason: z.string().min(10), risk: z.literal('HIGH') }).strict(),
  z.object({ type: z.literal('waitForStable'), timeoutMs: z.number().int().positive().max(10000).optional(), reason }).strict(),
  z.object({ type: z.literal('navigate'), to: z.string(), reason }).strict(),
  z.object({ type: z.literal('drag'), source: LocatorDescriptorSchema, target: LocatorDescriptorSchema, reason }).strict(),
  z.object({ type: z.literal('uploadFile'), target: LocatorDescriptorSchema, filePath: z.string().min(1), reason }).strict(),
  z.object({ type: z.literal('waitForCondition'), text: z.string().min(1), timeoutMs: z.number().int().positive().max(30000).optional(), reason }).strict(),
  z.object({ type: z.literal('compareScreenshot'), baselinePath: z.string().min(1), threshold: z.number().min(0).max(1).optional(), reason }).strict(),
  z.object({ type: z.literal('auditAccessibility'), reason }).strict(),
  z.object({ type: z.literal('acceptDialog'), text: z.string().optional(), reason }).strict(),
  z.object({ type: z.literal('dismissDialog'), reason }).strict(),
  z.object({ type: z.literal('richTextFill'), target: LocatorDescriptorSchema, value: z.string(), reason }).strict(),
  z.object({ type: z.literal('extract'), target: LocatorDescriptorSchema, key: z.string().min(1), source: z.enum(['text', 'value']).default('text'), reason }).strict(),
  z.object({ type: z.literal('assertVisible'), target: LocatorDescriptorSchema.optional(), text: z.string().optional(), reason }).strict().refine((a) => a.target || a.text, 'assertVisible requires target or text'),
  z.object({ type: z.literal('abortScenario'), reason: z.string().min(10) }).strict(),
]);

export const ExecutionStepSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  description: z.string().min(1),
  preconditions: z.array(PreconditionSchema).default([]),
  action: PlanActionSchema,
  postconditions: z.array(PostconditionSchema).min(1),
  assertions: z.array(BusinessAssertionSchema).default([]),
  onFailure: StepFailurePolicySchema.default('RECOVER'),
  maxAttempts: z.number().int().positive().optional(),
  repeatUntil: PlanConditionSchema.optional(),
  maxIterations: z.number().int().positive().max(100).optional(),
  isFallback: z.boolean().optional(),
}).strict();

export const PlanPatchSchema = z.object({
  basePlanId: z.string().min(1),
  basePlanVersion: z.number().int().nonnegative(),
  operation: z.enum(['insert_after', 'replace_step', 'replace_remaining_steps', 'mark_blocked']),
  stepId: z.string().min(1).optional(),
  reason: z.string().min(1),
  replanReason: ReplanReasonSchema,
  steps: z.array(ExecutionStepSchema).default([]),
}).strict().superRefine((patch, ctx) => {
  const needsStepId = patch.operation !== 'mark_blocked';
  const needsSteps = patch.operation !== 'mark_blocked';
  if (needsStepId && !patch.stepId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${patch.operation} requires stepId`, path: ['stepId'] });
  if (needsSteps && patch.steps.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${patch.operation} requires replacement steps`, path: ['steps'] });
  const text = JSON.stringify(patch);
  if (/"targetElementId"\s*:/.test(text) || /\bel_\d{3}\b/.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PlanPatch must not persist targetElementId or el_* ephemeral ids' });
  }
});

export const ExecutionPlanSchema = z.object({
  schemaVersion: z.literal('execution-plan.v1').default('execution-plan.v1'),
  planId: z.string().min(1),
  version: z.number().int().nonnegative().default(1),
  goal: z.string().min(1),
  mode: RuntimeModeSchema.default('HYBRID_GUARDED'),
  runtime: z.object({
    maxAttemptsPerStep: z.number().int().positive().default(2),
    maxReplansPerScenario: z.number().int().nonnegative().default(2),
    destructiveActionPolicy: DestructiveActionPolicySchema.default('BLOCK'),
  }).default({ maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' }),
  steps: z.array(ExecutionStepSchema).min(1),
  assertions: z.array(BusinessAssertionSchema).default([]),
  metadata: z.object({
    planSource: z.string().optional(),
    fallbackReason: z.string().optional(),
    fallbackWarning: z.string().optional(),
    qualityAudit: z.object({
      semanticTargetsPerTask: z.number().int().nonnegative(),
      hasFragileTargets: z.boolean(),
      hasGenericTargets: z.boolean(),
      hasUnobservableTargets: z.boolean(),
    }).optional(),
  }).optional(),
}).strict().superRefine((plan, ctx) => {
  const text = JSON.stringify(plan);
  if (/"targetElementId"\s*:/.test(text) || /\bel_\d{3}\b/.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ExecutionPlan must not persist targetElementId or el_* ephemeral ids' });
  }
});

export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type StepFailurePolicy = z.infer<typeof StepFailurePolicySchema>;
export type DestructiveActionPolicy = z.infer<typeof DestructiveActionPolicySchema>;
export type ReplanReason = z.infer<typeof ReplanReasonSchema>;
export type PlanCondition = z.infer<typeof PlanConditionSchema>;
export type RuntimeStateSnapshot = z.infer<typeof RuntimeStateSnapshotSchema>;
export type PlanAction = z.infer<typeof PlanActionSchema>;
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type PlanPatch = z.infer<typeof PlanPatchSchema>;
