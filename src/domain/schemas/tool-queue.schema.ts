import { z } from 'zod';
import { LocatorDescriptorSchema } from './action.schema.js';
import { ExpectedOutcomeSchema } from './expected-outcome.schema.js';
import { PlanConditionSchema } from './execution-plan.schema.js';

export const ToolNameSchema = z.enum([
  'navigator.open',
  'observer.capture',
  'actor.click',
  'actor.fill',
  'actor.type',
  'actor.press',
  'validator.state',
  'explorer.scan',
]);

export type ToolName = z.infer<typeof ToolNameSchema>;

/* ------------------------------------------------------------------ */
/*  Tool-specific params                                               */
/* ------------------------------------------------------------------ */

export const NavigatorOpenParamsSchema = z.object({
  url: z.string().min(1),
  expectedTitle: z.string().optional(),
}).strict();

export const ObserverCaptureParamsSchema = z.object({
  includeScreenshot: z.boolean().optional(),
  includeAccessibilityTree: z.boolean().optional(),
  includeDomSummary: z.boolean().optional(),
  fullPage: z.boolean().optional(),
}).strict();

export const ActorClickParamsSchema = z.object({
  target: LocatorDescriptorSchema,
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export const ActorFillParamsSchema = z.object({
  target: LocatorDescriptorSchema,
  value: z.string().min(1),
}).strict();

export const ActorTypeParamsSchema = z.object({
  text: z.string().min(1),
  delayMs: z.number().int().positive().optional(),
}).strict();

export const ActorPressParamsSchema = z.object({
  key: z.enum(['Escape', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']),
}).strict();

export const ValidatorStateParamsSchema = z.object({
  condition: PlanConditionSchema,
}).strict();

export const ExplorerScanParamsSchema = z.object({
  mode: z.enum([
    'scan_clickables',
    'scan_inputs',
    'scan_accessibility_tree',
    'scan_semantic_candidates',
    'full_observation',
  ]),
}).strict();

/* ------------------------------------------------------------------ */
/*  FallbackToolCallSchema — não-recursivo, tool+params tipados       */
/* ------------------------------------------------------------------ */

export const FallbackToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('navigator.open'), params: NavigatorOpenParamsSchema }),
  z.object({ tool: z.literal('observer.capture'), params: ObserverCaptureParamsSchema }),
  z.object({ tool: z.literal('actor.click'), params: ActorClickParamsSchema }),
  z.object({ tool: z.literal('actor.fill'), params: ActorFillParamsSchema }),
  z.object({ tool: z.literal('actor.type'), params: ActorTypeParamsSchema }),
  z.object({ tool: z.literal('actor.press'), params: ActorPressParamsSchema }),
  z.object({ tool: z.literal('validator.state'), params: ValidatorStateParamsSchema }),
  z.object({ tool: z.literal('explorer.scan'), params: ExplorerScanParamsSchema }),
]);

export type FallbackToolCall = z.infer<typeof FallbackToolCallSchema>;

/* ------------------------------------------------------------------ */
/*  ToolQueueItemSchema — discriminated union por tool                */
/* ------------------------------------------------------------------ */

export const ToolQueueItemSchema = z.discriminatedUnion('tool', [
  z.object({ step: z.number().int().positive(), tool: z.literal('navigator.open'), params: NavigatorOpenParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('observer.capture'), params: ObserverCaptureParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.click'), params: ActorClickParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.fill'), params: ActorFillParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.type'), params: ActorTypeParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.press'), params: ActorPressParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('validator.state'), params: ValidatorStateParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('explorer.scan'), params: ExplorerScanParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
]);

export type ToolQueueItem = z.infer<typeof ToolQueueItemSchema>;

/* ------------------------------------------------------------------ */
/*  ToolQueueSchema                                                    */
/* ------------------------------------------------------------------ */

export const ToolQueueSchema = z.object({
  taskQueue: z.array(ToolQueueItemSchema),
  reasoning: z.string().max(800),
});

export type ToolQueue = z.infer<typeof ToolQueueSchema>;
