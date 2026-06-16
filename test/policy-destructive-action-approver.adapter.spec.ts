import { describe, expect, it } from 'vitest';
import { PolicyDestructiveActionApproverAdapter } from '../src/infra/approval/policy-destructive-action-approver.adapter.js';
import type { DestructiveActionApprovalInput } from '../src/application/ports/destructive-action-approver.port.js';

function makeInput(policy: 'ALLOW' | 'BLOCK' | 'ASK_APPROVAL'): DestructiveActionApprovalInput {
  return {
    action: { type: 'click', targetElementId: 'el_001', reason: 'test' },
    reason: 'destructive action test',
    stepId: 'S001',
    policy,
  };
}

describe('PolicyDestructiveActionApproverAdapter', () => {
  const adapter = new PolicyDestructiveActionApproverAdapter();

  it('approves when policy is ALLOW', async () => {
    const result = await adapter.approve(makeInput('ALLOW'));
    expect(result).toBe(true);
  });

  it('rejects when policy is BLOCK', async () => {
    const result = await adapter.approve(makeInput('BLOCK'));
    expect(result).toBe(false);
  });

  it('rejects when policy is ASK_APPROVAL (no interactive channel)', async () => {
    const result = await adapter.approve(makeInput('ASK_APPROVAL'));
    expect(result).toBe(false);
  });

  it('rejects for any policy other than ALLOW', async () => {
    const result = await adapter.approve(makeInput('ASK_APPROVAL'));
    expect(result).toBe(false);
  });
});
