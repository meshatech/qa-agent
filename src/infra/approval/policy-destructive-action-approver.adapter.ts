import { Injectable } from '@nestjs/common';
import type { DestructiveActionApprovalInput, DestructiveActionApproverPort } from '../../application/ports/destructive-action-approver.port.js';

/**
 * Non-interactive adapter that resolves approval based on destructiveActionPolicy:
 * - ALLOW → approve
 * - BLOCK → reject (run fails)
 * - ASK_APPROVAL / ALLOW_ONLY_IN_TEST_ENV → reject (no interactive channel in this context)
 *
 * Interactive callers can swap in their own adapter and resume the graph with
 * `graph.invoke(new Command({ resume: true }), threadConfig)` after this rejects.
 */
@Injectable()
export class PolicyDestructiveActionApproverAdapter implements DestructiveActionApproverPort {
  async approve(input: DestructiveActionApprovalInput): Promise<boolean> {
    return input.policy === 'ALLOW';
  }
}
