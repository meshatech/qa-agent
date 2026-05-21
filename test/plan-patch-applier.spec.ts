import { describe, expect, it } from 'vitest';
import { PlanPatchApplierService } from '../src/application/services/plan-patch-applier.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import type { ExecutionPlan, PlanPatch } from '../src/domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

const config = {
  runtime: { destructiveActionPolicy: 'BLOCK' },
  allowedRoutes: undefined,
} as RunConfig;

const baseStep = {
  id: 'S001',
  description: 'Abrir menu',
  preconditions: [],
  action: { type: 'click' as const, target: { strategy: 'role' as const, role: 'button' as const, name: 'Conta' }, reason: 'open menu' },
  postconditions: [{ type: 'text_visible' as const, text: 'Sair' }],
  assertions: [],
  onFailure: 'RECOVER' as const,
};

const plan: ExecutionPlan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'plan-1',
  version: 1,
  goal: 'Smoke',
  mode: 'HYBRID_GUARDED',
  runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' },
  steps: [baseStep],
  assertions: [],
};

const applier = () => new PlanPatchApplierService(new ActionPolicyService());

function patch(overrides: Partial<PlanPatch> = {}): PlanPatch {
  return {
    basePlanId: 'plan-1',
    basePlanVersion: 1,
    operation: 'replace_step',
    stepId: 'S001',
    reason: 'fix locator',
    replanReason: 'LOCATOR_NOT_FOUND',
    steps: [{ ...baseStep, action: { type: 'click', target: { strategy: 'text', text: 'Conta' }, reason: 'open account menu' } }],
    ...overrides,
  };
}

describe('PlanPatchApplierService', () => {
  it('rejects stale plan version', () => {
    expect(() => applier().apply(plan, patch({ basePlanVersion: 0 }), config)).toThrow(/version/i);
  });

  it('rejects stale plan id', () => {
    expect(() => applier().apply(plan, patch({ basePlanId: 'other' }), config)).toThrow(/basePlanId/i);
  });

  it('applies replace_step and increments version', () => {
    const result = applier().apply(plan, patch(), config);
    expect(result.plan.version).toBe(2);
    expect(result.plan.steps[0]?.action.type).toBe('click');
  });

  it('applies insert_after', () => {
    const result = applier().apply(plan, patch({ operation: 'insert_after' }), config);
    expect(result.plan.steps).toHaveLength(2);
  });

  it('applies replace_remaining_steps', () => {
    const result = applier().apply({ ...plan, steps: [baseStep, { ...baseStep, id: 'S002' }] }, patch({ operation: 'replace_remaining_steps' }), config);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.version).toBe(2);
  });

  it('supports mark_blocked without changing version', () => {
    const result = applier().apply(plan, patch({ operation: 'mark_blocked', steps: [] }), config);
    expect(result.history.status).toBe('BLOCKED');
    expect(result.plan.version).toBe(1);
  });

  it('rejects removal of primary postcondition', () => {
    const weakened = { ...baseStep, postconditions: [] };
    expect(() => applier().apply(plan, patch({ steps: [weakened] }), config)).toThrow(/postcondition/i);
  });

  it('rejects removal of critical business assertions', () => {
    const planWithAssertion = { ...plan, steps: [{ ...baseStep, assertions: [{ type: 'text_visible' as const, text: 'Produto criado' }] }] };
    expect(() => applier().apply(planWithAssertion, patch(), config)).toThrow(/business assertions/i);
  });

  it('rejects functional step weakened to warning', () => {
    const weakened = { ...baseStep, onFailure: 'CONTINUE_WITH_WARNING' as const };
    expect(() => applier().apply(plan, patch({ steps: [weakened] }), config)).toThrow(/CONTINUE_WITH_WARNING/i);
  });

  it('blocks destructive action by policy', () => {
    const destructive = { ...baseStep, description: 'Excluir registro', action: { type: 'click' as const, target: { strategy: 'text' as const, text: 'Excluir' }, reason: 'delete record' } };
    expect(() => applier().apply(plan, patch({ steps: [destructive] }), config)).toThrow(/Destructive action blocked/i);
  });
});
