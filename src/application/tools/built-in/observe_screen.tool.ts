import { ScreenObservationSchema, type ScreenObservation } from '../../../domain/schemas/observation.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  ScreenObserveInputSchema,
  ToolResultSchema,
  type BrowserToolService,
  type ScreenObserveInput,
  type ToolResult,
} from './contracts.js';
import { contextService, ok } from './support.js';

export const ScreenObserveTool: QaTool<ScreenObserveInput, ToolResult> = {
  name: 'qa.screen.observe',
  description: 'Return a controlled ScreenObservation from the current browser session without executing actions.',
  inputSchema: ScreenObserveInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const browser = contextService<BrowserToolService>(context, 'browser');
    const observation = ScreenObservationSchema.parse(await browser.observe());
    const result: Record<string, unknown> = { observation };

    if (input.includeUrl) result.url = observation.url;
    if (input.includeDom) result.domSnapshot = await browser.domSnapshot?.();
    if (input.includeScreenshot) result.screenshotBase64 = (await browser.screenshot?.())?.toString('base64');
    if (input.includeAccessibilityTree) result.accessibilityTree = accessibilityTree(observation);
    if (input.includeConsoleSummary) result.consoleSummary = consoleSummary(observation);

    return ok(result);
  },
};

function accessibilityTree(observation: ScreenObservation): Array<{ id: string; role: string; name: string; text?: string }> {
  return observation.elements.map(({ id, role, name, text }) => ({ id, role, name, text }));
}

function consoleSummary(observation: ScreenObservation): { total: number; byLevel: Record<string, number>; appOriginCount: number } {
  const byLevel: Record<string, number> = {};
  let appOriginCount = 0;

  for (const signal of observation.consoleSignals) {
    byLevel[signal.level] = (byLevel[signal.level] ?? 0) + 1;
    if (signal.isAppOrigin) appOriginCount += 1;
  }

  return {
    total: observation.consoleSignals.length,
    byLevel,
    appOriginCount,
  };
}
