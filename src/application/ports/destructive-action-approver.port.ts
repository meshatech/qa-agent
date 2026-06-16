import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { DestructiveActionPolicy } from '../../domain/schemas/execution-plan.schema.js';

export interface DestructiveActionApprovalInput {
  action: QaAction;
  reason: string;
  stepId: string;
  policy: DestructiveActionPolicy;
}

export interface DestructiveActionApproverPort {
  approve(input: DestructiveActionApprovalInput): Promise<boolean>;
}
