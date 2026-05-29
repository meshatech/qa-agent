import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ExecutionPlanSchema, PlanPatchSchema } from '../src/domain/schemas/execution-plan.schema.js';

const basePlan = {
  planId: 'plan-smoke',
  goal: 'Smoke',
  steps: [{
    id: 'S001',
    description: 'Open menu',
    action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta e opções' }, reason: 'open menu' },
    postconditions: [{ type: 'text_visible', text: 'Sair' }],
  }],
};

describe('ExecutionPlanSchema', () => {
  it('accepts locator descriptors and applies guarded defaults', () => {
    const plan = ExecutionPlanSchema.parse(basePlan);

    expect(plan.mode).toBe('HYBRID_GUARDED');
    expect(plan.runtime.maxAttemptsPerStep).toBe(2);
    expect(plan.steps[0]?.postconditions[0]?.type).toBe('text_visible');
  });

  it('rejects persisted ephemeral element ids', () => {
    expect(() => ExecutionPlanSchema.parse({
      ...basePlan,
      steps: [{
        id: 'S001',
        description: 'Bad',
        action: { type: 'click', targetElementId: 'el_001', reason: 'bad' },
        postconditions: [{ type: 'text_visible', text: 'Sair' }],
      }],
    })).toThrow(ZodError);
  });

  it('validates plan patches independently', () => {
    const patch = PlanPatchSchema.parse({
      basePlanId: 'plan-smoke',
      basePlanVersion: 1,
      operation: 'replace_step',
      stepId: 'S001',
      reason: 'Use another locator',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [basePlan.steps[0]],
    });

    expect(patch.operation).toBe('replace_step');
  });

  it('rejects semantic locator without candidates', () => {
    expect(() => ExecutionPlanSchema.parse({
      ...basePlan,
      steps: [{
        id: 'S001',
        description: 'Bad semantic locator',
        action: { type: 'click', target: { strategy: 'semantic', semanticKey: 'save_button', intent: 'save form', candidates: [] }, reason: 'save' },
        postconditions: [{ type: 'text_visible', text: 'Salvo' }],
      }],
    })).toThrow(ZodError);
  });

  it('accepts runtime conditions for changed state', () => {
    const plan = ExecutionPlanSchema.parse({
      ...basePlan,
      steps: [{
        id: 'S001',
        description: 'Toggle appearance',
        action: { type: 'click', target: { strategy: 'text_any', texts: ['Tema escuro', 'Tema claro'] }, reason: 'toggle appearance' },
        postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' }],
      }],
    });

    expect(plan.steps[0]?.postconditions[0]?.type).toBe('ui_state');
  });
});
