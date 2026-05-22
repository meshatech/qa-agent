import type { EnsureElementAvailablePolicy } from '../../services/element-availability-resolver.service.js';
import type { PlanAction } from '../../../domain/schemas/execution-plan.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  ElementEnsureAvailableInputSchema,
  ToolResultSchema,
  type ElementEnsureAvailableInput,
  type ToolResult,
} from './contracts.js';
import { configFrom, contextService, failed, ok } from './support.js';

interface ElementAvailabilityService {
  ensureAvailable(input: unknown): Promise<unknown>;
}

export const ElementEnsureAvailableTool: QaTool<ElementEnsureAvailableInput, ToolResult> = {
  name: 'qa.element.ensureAvailable',
  description: 'Ensure a locator target is available using ElementAvailabilityResolver under runtime policy.',
  internalOnly: true,
  inputSchema: ElementEnsureAvailableInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const policy = (input.availabilityPolicy ?? input.policy) as EnsureElementAvailablePolicy;
    const policyIssue = validateAvailabilityPolicy(policy);
    if (policyIssue) return failed({ path: 'availabilityPolicy', code: 'UNSAFE_AVAILABILITY_POLICY', message: policyIssue });

    const availability = contextService<ElementAvailabilityService>(context, 'elementAvailability');
    return ok(await availability.ensureAvailable({
      target: input.target,
      observation: input.currentObservation ?? input.observation,
      policy,
      config: configFrom(input, context, 'qa.element.ensureAvailable'),
      runContext: input.runContext,
    }));
  },
};

function validateAvailabilityPolicy(policy: EnsureElementAvailablePolicy): string | undefined {
  if (!Array.isArray(policy.allowedContainers)) return 'allowedContainers must be an array';
  for (const container of policy.allowedContainers) {
    const unsafeReason = unsafeOpenActionReason(container.openAction);
    if (unsafeReason) return `Container ${container.semanticKey} has unsafe openAction: ${unsafeReason}`;
  }
  return undefined;
}

function unsafeOpenActionReason(action: PlanAction): string | undefined {
  if (action.type === 'clickOutside') return 'clickOutside is not allowed for element availability';
  if (action.type === 'clickAtCoordinates') return 'clickAtCoordinates is not allowed for element availability';
  if (action.type === 'navigate') return 'navigate is not allowed for element availability';
  if (action.type === 'fill') return 'fill is not allowed for element availability';
  if ('target' in action && !action.target && action.type !== 'press') return 'targeted container actions must declare a LocatorDescriptor';
  return undefined;
}
