import type { LocatorDescriptor } from '../../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../../domain/schemas/observation.schema.js';
import type { QaTool } from '../qa-tool.js';
import { ConditionEvaluateTool } from './evaluate_condition.tool.js';
import { ElementEnsureAvailableTool } from './ensure_element_available.tool.js';
import {
  ActionExecuteInternalInputSchema,
  LocatorResolveInputSchema,
  QuiescenceWaitInputSchema,
  ToolResultSchema,
  type ActionExecuteInternalInput,
  type ActionPolicyToolService,
  type BrowserToolService,
  type LocatorResolveInput,
  type QuiescenceWaitInput,
  type ToolResult,
} from './contracts.js';
import { configFrom, contextService, failed, ok } from './support.js';

export const LocatorResolveTool: QaTool<LocatorResolveInput, ToolResult> = {
  name: 'qa.locator.resolve',
  description: 'Resolve a LocatorDescriptor to the current ScreenObservation element id for internal runtime use.',
  internalOnly: true,
  inputSchema: LocatorResolveInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const resolver = contextService<{
      rebuild?(observation: ScreenObservation): void;
      findByLocator(observation: ScreenObservation, locator: LocatorDescriptor): string;
    }>(context, 'locatorResolver');
    resolver.rebuild?.(input.observation);
    return ok({ elementId: resolver.findByLocator(input.observation, input.locator) });
  },
};

export const ActionExecuteInternalTool: QaTool<ActionExecuteInternalInput, ToolResult> = {
  name: 'qa.action.executeInternal',
  description: 'Execute an already validated QaAction inside runtime boundaries.',
  internalOnly: true,
  inputSchema: ActionExecuteInternalInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const browser = contextService<Required<Pick<BrowserToolService, 'execute'>>>(context, 'browser');
    const policy = context.metadata?.actionPolicy as ActionPolicyToolService | undefined;
    if (policy) {
      const validation = policy.validate(input.action, configFrom(input, context, 'qa.action.executeInternal'), input.attempts);
      if (!validation.ok) return failed({ path: 'action', code: validation.code, message: validation.message });
    }
    return ok(await browser.execute(input.action));
  },
};

export const QuiescenceWaitTool: QaTool<QuiescenceWaitInput, ToolResult> = {
  name: 'qa.quiescence.wait',
  description: 'Wait for DOM/network/UI quiescence after an action for internal runtime use.',
  internalOnly: true,
  inputSchema: QuiescenceWaitInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const browser = contextService<Required<Pick<BrowserToolService, 'waitForQuiescence'>>>(context, 'browser');
    return ok(await browser.waitForQuiescence(input.timeoutMs));
  },
};

export const INTERNAL_QA_TOOL_CATALOG = [
  ConditionEvaluateTool,
  ElementEnsureAvailableTool,
  LocatorResolveTool,
  ActionExecuteInternalTool,
  QuiescenceWaitTool,
];
