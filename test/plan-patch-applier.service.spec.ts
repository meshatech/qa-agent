import { describe, expect, it } from 'vitest';
import { PlanPatchApplierService } from '../src/application/services/plan-patch-applier.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { DomainError } from '../src/domain/shared/result.js';
import type { ExecutionPlan, PlanPatch } from '../src/domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

const mockConfig = {
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
  runtime: { mode: 'PLAN_AND_EXECUTE', maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
} as RunConfig;

const basePlan: ExecutionPlan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'plan_test',
  version: 1,
  goal: 'Test',
  mode: 'PLAN_AND_EXECUTE',
  runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
  steps: [
    {
      id: 'S1',
      scenarioId: 'sc1',
      taskId: 't1',
      description: 'First step',
      preconditions: [],
      action: { type: 'navigate', to: 'https://app.local', reason: 'Go' },
      postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
      assertions: [{ type: 'no_console_errors' }],
      onFailure: 'RECOVER',
    },
    {
      id: 'S2',
      scenarioId: 'sc1',
      taskId: 't2',
      description: 'Second step',
      preconditions: [],
      action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Save' }, reason: 'Click' },
      postconditions: [{ type: 'element_visible', target: { strategy: 'role', role: 'button', name: 'Save' } }],
      assertions: [],
      onFailure: 'RECOVER',
    },
  ],
  assertions: [],
};

function makeService() {
  return new PlanPatchApplierService(new ActionPolicyService());
}

describe('PlanPatchApplierService', () => {
  it('applies mark_blocked without changing plan', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'mark_blocked',
      reason: 'Element not found',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [],
    };

    const result = service.apply(basePlan, patch, mockConfig);

    expect(result.plan).toEqual(basePlan);
    expect(result.history.status).toBe('BLOCKED');
  });

  it('inserts steps after target step', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'insert_after',
      stepId: 'S1',
      reason: 'Add wait',
      replanReason: 'MODAL_OR_OVERLAY_DETECTED',
      steps: [{
        id: 'S1a',
        scenarioId: 'sc1',
        taskId: 't1',
        description: 'Wait',
        preconditions: [],
        action: { type: 'waitForStable', timeoutMs: 1000, reason: 'Wait' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'RECOVER',
      }],
    };

    const result = service.apply(basePlan, patch, mockConfig);

    expect(result.plan.steps.length).toBe(3);
    expect(result.plan.steps[1]!.id).toBe('S1a');
    expect(result.history.status).toBe('APPLIED');
    expect(result.plan.version).toBe(2);
  });

  it('replaces target step', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'replace_step',
      stepId: 'S2',
      reason: 'Replace click with navigate',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [{
        id: 'S2new',
        scenarioId: 'sc1',
        taskId: 't2',
        description: 'Navigate instead',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local/other', reason: 'Navigate' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local/other' }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'RECOVER',
      }],
    };

    const result = service.apply(basePlan, patch, mockConfig);

    expect(result.plan.steps.length).toBe(2);
    expect(result.plan.steps[1]!.id).toBe('S2new');
  });

  it('throws when basePlanId does not match', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'wrong_plan',
      basePlanVersion: 1,
      operation: 'mark_blocked',
      reason: 'Test',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [],
    };

    expect(() => service.apply(basePlan, patch, mockConfig)).toThrow(DomainError);
  });

  it('throws when basePlanVersion does not match', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 99,
      operation: 'mark_blocked',
      reason: 'Test',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [],
    };

    expect(() => service.apply(basePlan, patch, mockConfig)).toThrow(DomainError);
  });

  it('throws when step not found for replace', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'replace_step',
      stepId: 'NONEXISTENT',
      reason: 'Test',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [{
        id: 'Snew',
        scenarioId: 'sc1',
        taskId: 't1',
        description: 'New step',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local', reason: 'Go' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'RECOVER',
      }],
    };

    expect(() => service.apply(basePlan, patch, mockConfig)).toThrow(DomainError);
  });

  it('throws when patch weakens assertions', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'replace_step',
      stepId: 'S1',
      reason: 'Replace with fewer assertions',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [{
        id: 'S1bad',
        scenarioId: 'sc1',
        taskId: 't1',
        description: 'Bad step',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local', reason: 'Go' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
        assertions: [],
        onFailure: 'RECOVER',
      }],
    };

    expect(() => service.apply(basePlan, patch, mockConfig)).toThrow(DomainError);
  });

  it('allows insert_after to add steps', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'insert_after',
      stepId: 'S1',
      reason: 'Add step',
      replanReason: 'MODAL_OR_OVERLAY_DETECTED',
      steps: [{
        id: 'S1a',
        scenarioId: 'sc1',
        taskId: 't1',
        description: 'Extra step',
        preconditions: [],
        action: { type: 'waitForStable', timeoutMs: 1000, reason: 'Wait' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'RECOVER',
      }],
    };

    const result = service.apply(basePlan, patch, mockConfig);
    expect(result.history.status).toBe('APPLIED');
  });

  it('replaces remaining steps', () => {
    const service = makeService();
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'replace_remaining_steps',
      stepId: 'S2',
      reason: 'Replace rest',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [{
        id: 'S2new',
        scenarioId: 'sc1',
        taskId: 't2',
        description: 'New step',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local/final', reason: 'Go' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local/final' }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'RECOVER',
      }],
    };

    const result = service.apply(basePlan, patch, mockConfig);

    expect(result.plan.steps.length).toBe(2);
    expect(result.plan.steps[1]!.id).toBe('S2new');
  });
});
