import { describe, expect, it } from 'vitest';
import { LlmPlanPatchNormalizer } from '../src/infra/llm/llm-output-normalizer.js';

const plan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'p1',
  version: 1,
  goal: 'Smoke',
  steps: [{ id: 'S1', description: 'Wait', action: { type: 'waitForStable', reason: 'wait' }, postconditions: [{ type: 'no_console_errors' }] }],
};

const patch = {
  basePlanId: 'p1',
  basePlanVersion: 1,
  operation: 'mark_blocked',
  reason: 'blocked',
  replanReason: 'POSTCONDITION_FAILED',
  steps: [],
};

describe('LlmPlanPatchNormalizer', () => {
  it('normalizes plan wrappers', () => {
    const normalizer = new LlmPlanPatchNormalizer();
    expect(normalizer.parsePlan({ plan }).wrapper).toBe('plan');
    expect(normalizer.parsePlan({ executionPlan: plan }).wrapper).toBe('executionPlan');
  });

  it('normalizes patch wrappers', () => {
    const normalizer = new LlmPlanPatchNormalizer();
    expect(normalizer.parsePatch({ patch }).wrapper).toBe('patch');
    expect(normalizer.parsePatch({ patches: [patch] }).wrapper).toBe('patches');
  });

  it('rejects patches wrapper without valid patch', () => {
    expect(() => new LlmPlanPatchNormalizer().parsePatch({ patches: [{ nope: true }] })).toThrow(/No valid PlanPatch/);
  });

  it('repairs common loose LLM plan fields before final schema validation', () => {
    const result = new LlmPlanPatchNormalizer().parsePlan({
      planId: 'p1',
      goal: 'Smoke',
      steps: [{
        action: { type: 'navigate', target: { value: '/' } },
        postcondition: { type: 'ui_state', value: 'changed', locator: { strategy: 'document' } },
      }, {
        action: { type: 'fill', locator: { strategy: 'label', text: 'Nome' }, value: { generator: 'uniqueName', key: 'name', prefix: 'QA' } },
        postconditions: [{ type: 'field_value_contains', locator: { strategy: 'label', text: 'Nome' }, value: { generator: 'uniqueName', key: 'name' } }],
      }],
    });

    expect(result.value.steps[0]?.id).toBe('S001');
    expect(result.value.steps[0]?.action).toMatchObject({ type: 'navigate', to: '/', reason: 'Execution step 1' });
    expect(result.value.steps[0]?.postconditions[0]).toMatchObject({ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'changed' });
    expect(result.value.steps[1]?.action).toMatchObject({ type: 'fill', value: '{{uniqueName:name:QA}}' });
  });

  it('repairs route_state expected values that are phrased as contains', () => {
    const result = new LlmPlanPatchNormalizer().parsePlan({
      ...plan,
      steps: [{
        id: 'S1',
        description: 'Logout',
        action: { type: 'click', target: { strategy: 'text', text: 'Sair' }, reason: 'click logout' },
        postconditions: [{ type: 'route_state', expected: 'contains', expectedUrlPattern: '/login' }],
      }],
    });

    expect(result.value.steps[0]?.postconditions[0]).toMatchObject({ type: 'route_state', expected: 'matches', expectedUrlPattern: '/login' });
  });

  it('repairs provider-specific action and condition aliases', () => {
    const result = new LlmPlanPatchNormalizer().parsePlan({
      ...plan,
      steps: [{
        id: 'S1',
        description: 'Wait authenticated UI',
        action: { type: 'waitForStable', target: { strategy: 'document' }, reason: 'wait' },
        preconditions: [{ type: 'visible', text: 'Caixa de entrada' }],
        postconditions: [{ type: 'text_contains', value: 'Caixa de entrada' }],
      }],
    });

    expect(result.value.steps[0]?.action).toEqual({ type: 'waitForStable', reason: 'wait' });
    expect(result.value.steps[0]?.preconditions[0]).toMatchObject({ type: 'element_visible', text: 'Caixa de entrada' });
    expect(result.value.steps[0]?.postconditions[0]).toMatchObject({ type: 'text_visible', text: 'Caixa de entrada' });
  });

  it('repairs semantic locator candidates emitted as strings', () => {
    const result = new LlmPlanPatchNormalizer().parsePlan({
      ...plan,
      steps: [{
        id: 'S1',
        description: 'Toggle appearance',
        action: {
          type: 'click',
          target: {
            strategy: 'semantic',
            semanticKey: 'appearance_toggle',
            candidates: ['Tema escuro', 'Tema claro'],
          },
          reason: 'toggle appearance',
        },
        postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'changed' }],
      }],
    });

    expect(result.value.steps[0]?.action).toMatchObject({
      type: 'click',
      target: {
        strategy: 'semantic',
        semanticKey: 'appearance_toggle',
        intent: 'Toggle appearance',
        candidates: [{ strategy: 'text', text: 'Tema escuro' }, { strategy: 'text', text: 'Tema claro' }],
      },
    });
  });
});
