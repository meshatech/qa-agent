import { z } from 'zod';

const el = z.string().regex(/^el_\d{3}$/);
const reason = z.string().min(1);

const BaseLocatorDescriptorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('role'), role: z.string(), name: z.string().optional(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('label'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('placeholder'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('text'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('text_any'), texts: z.array(z.string().min(1)).min(1), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('testid'), value: z.string() }),
  z.object({ strategy: z.literal('document') }),
]);

type BaseLocatorDescriptorInput = z.infer<typeof BaseLocatorDescriptorSchema>;
type LocatorDescriptorInput = BaseLocatorDescriptorInput | { strategy: 'semantic'; semanticKey: string; intent: string; candidates: LocatorDescriptorInput[]; minConfidence?: number };

export const LocatorDescriptorSchema: z.ZodType<LocatorDescriptorInput> = z.lazy(() => z.discriminatedUnion('strategy', [
  ...BaseLocatorDescriptorSchema.options,
  z.object({
    strategy: z.literal('semantic'),
    semanticKey: z.string().min(1),
    intent: z.string().min(1),
    candidates: z.array(LocatorDescriptorSchema).min(1),
    minConfidence: z.number().min(0).max(1).optional(),
  }),
]));

export const QaActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), targetElementId: el, reason }),
  z.object({ type: z.literal('fill'), targetElementId: el, value: z.string(), reason }),
  z.object({ type: z.literal('select'), targetElementId: el, option: z.union([z.object({ label: z.string() }), z.object({ value: z.string() }), z.object({ index: z.number().int().nonnegative() })]), reason }),
  z.object({ type: z.literal('press'), key: z.enum(['Escape', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']), targetElementId: el.optional(), reason }),
  z.object({ type: z.literal('clickOutside'), reason }),
  z.object({ type: z.literal('clickAtCoordinates'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), reason: z.string().min(10), risk: z.literal('HIGH') }),
  z.object({ type: z.literal('waitForStable'), timeoutMs: z.number().int().positive().max(10000).optional(), reason }),
  z.object({ type: z.literal('navigate'), to: z.string(), reason }),
  z.object({ type: z.literal('assertVisible'), targetElementId: el.optional(), text: z.string().optional(), reason }).refine((a) => a.targetElementId || a.text, 'assertVisible requires targetElementId or text'),
  z.object({ type: z.literal('assertText'), targetElementId: el, expected: z.string(), match: z.enum(['equals', 'contains', 'regex']).default('contains'), reason }),
  z.object({ type: z.literal('abortScenario'), reason: z.string().min(10) }),
]);

export const ExpectedAfterActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field_value_contains'), targetElementId: el, value: z.string() }),
  z.object({ type: z.literal('element_visible'), targetElementId: el.optional(), text: z.string().optional() }).refine((a) => a.targetElementId || a.text, 'element_visible requires targetElementId or text'),
  z.object({ type: z.literal('text_visible'), text: z.string() }),
  z.object({ type: z.literal('url_contains'), value: z.string() }),
  z.object({ type: z.literal('no_console_errors') }),
]);

export const BoundValidationTargetSchema = z.object({
  originalElementId: el,
  observationId: z.string(),
  locator: LocatorDescriptorSchema,
  humanName: z.string().optional(),
});

export const BoundExpectedAfterActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field_value_contains'), target: BoundValidationTargetSchema, value: z.string() }),
  z.object({ type: z.literal('element_visible'), target: BoundValidationTargetSchema.optional(), text: z.string().optional() }).refine((a) => a.target || a.text, 'element_visible requires target or text'),
  z.object({ type: z.literal('text_visible'), text: z.string() }),
  z.object({ type: z.literal('url_contains'), value: z.string() }),
  z.object({ type: z.literal('no_console_errors') }),
]);

export const QaActionEnvelopeSchema = z.object({
  schemaVersion: z.literal('action.v1').default('action.v1'),
  observationId: z.string(),
  thought_summary: z.string().min(1).max(500),
  action: QaActionSchema,
  expected_after_action: ExpectedAfterActionSchema,
  fallback_action: QaActionSchema,
  confidence: z.number().min(0).max(1),
});

export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
export type QaAction = z.infer<typeof QaActionSchema>;
export type ExpectedAfterAction = z.infer<typeof ExpectedAfterActionSchema>;
export type BoundExpectedAfterAction = z.infer<typeof BoundExpectedAfterActionSchema>;
export type QaActionEnvelope = z.infer<typeof QaActionEnvelopeSchema>;
