import { z } from 'zod';
import { LocatorDescriptorSchema } from './action.schema.js';

export const ObservableElementSchema = z.object({
  id: z.string().regex(/^el_\d{3}$/),
  role: z.string(),
  name: z.string(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  required: z.boolean().optional(),
  expanded: z.boolean().optional(),
  focused: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  inViewport: z.boolean(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  axRef: z.string().optional(),
  source: z.enum(['ax', 'dom']).optional(),
  locator: LocatorDescriptorSchema,
  ariaLabel: z.string().optional(),
  title: z.string().optional(),
  alt: z.string().optional(),
  className: z.string().optional(),
});

export const ScreenObservationSchema = z.object({
  observationId: z.string(),
  createdAt: z.string(),
  url: z.string(),
  title: z.string(),
  visibleTexts: z.array(z.string()),
  elements: z.array(ObservableElementSchema),
  pageState: z.object({
    isLoading: z.boolean(),
    hasModal: z.boolean(),
    hasToast: z.boolean(),
    hasValidationErrors: z.boolean(),
    hasOverlay: z.boolean().optional(),
  }),
  consoleSignals: z.array(z.object({ level: z.string(), text: z.string(), source: z.string().optional(), isAppOrigin: z.boolean(), timestamp: z.string() })).default([]),
  networkSignals: z.array(z.object({ method: z.string(), url: z.string(), status: z.number(), isAppOrigin: z.boolean(), failure: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), timestamp: z.string() })).default([]),
  screenshot: z.string().optional(),
  meta: z.object({
    viewport: z.object({ width: z.number(), height: z.number() }),
    schemaVersion: z.literal('obs.v1'),
    accessibilitySource: z.enum(['cdp', 'ariaSnapshot']).optional(),
    accessibilityNodeCount: z.number().int().nonnegative().optional(),
  }),
});

export type ObservableElement = z.infer<typeof ObservableElementSchema>;
export type ScreenObservation = z.infer<typeof ScreenObservationSchema>;
