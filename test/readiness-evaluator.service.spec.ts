import { describe, expect, it } from 'vitest';

import { ReadinessEvaluatorService } from '../src/application/services/readiness-evaluator.service.js';

function makeEvaluator() {
  return new ReadinessEvaluatorService();
}

function makeInput(
  overrides: Partial<import('../src/application/services/readiness-evaluator.service.js').ReadinessEvaluationInput> = {},
): import('../src/application/services/readiness-evaluator.service.js').ReadinessEvaluationInput {
  return {
    browserOpenOk: true,
    minimalSmokeOk: true,
    routeCheckOk: true,
    smokeResult: null,
    executionError: false,
    ...overrides,
  };
}

function makeSmokeResult(ok: boolean): import('../src/application/services/plan-executor.service.js').PlanExecutionResult {
  return {
    ok,
    steps: [],
    attempts: [],
    warnings: ok ? [] : [{ stepId: 'ONB-001', message: 'Navigation timeout' }],
    finalPlan: {
      schemaVersion: 'execution-plan.v1',
      planId: 'onboarding-smoke',
      version: 1,
      goal: 'Smoke',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      steps: [],
      assertions: [],
    },
    patchHistory: [],
    evaluations: [],
    locatorTelemetry: [],
    failedMessage: ok ? undefined : 'Navigation timeout',
  };
}

describe('ReadinessEvaluatorService', () => {
  it('returns UNKNOWN as initial state when no input provided', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput());
    expect(result).toBe('UNKNOWN');
  });

  it('returns READY when browser opened and smoke passed', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ smokeResult: makeSmokeResult(true) }));
    expect(result).toBe('READY');
  });

  it('returns ONBOARDING_BLOCKED when browser failed to open', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ browserOpenOk: false }));
    expect(result).toBe('ONBOARDING_BLOCKED');
  });

  it('returns ONBOARDING_BLOCKED when smoke failed', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ smokeResult: makeSmokeResult(false) }));
    expect(result).toBe('ONBOARDING_BLOCKED');
  });

  it('returns ONBOARDING_BLOCKED when minimal smoke checks fail', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ minimalSmokeOk: false, smokeResult: makeSmokeResult(true) }));
    expect(result).toBe('ONBOARDING_BLOCKED');
  });

  it('returns ONBOARDING_BLOCKED when route checks fail', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ routeCheckOk: false, smokeResult: makeSmokeResult(true) }));
    expect(result).toBe('ONBOARDING_BLOCKED');
  });

  it('returns ONBOARDING_BLOCKED when execution error occurred', () => {
    const evaluator = makeEvaluator();
    const result = evaluator.evaluate(makeInput({ smokeResult: makeSmokeResult(true), executionError: true }));
    expect(result).toBe('ONBOARDING_BLOCKED');
  });

  it('transitions are deterministic: same input always yields same output', () => {
    const evaluator = makeEvaluator();
    const input = makeInput({ smokeResult: makeSmokeResult(false) });

    const r1 = evaluator.evaluate(input);
    const r2 = evaluator.evaluate(input);
    const r3 = evaluator.evaluate(input);

    expect(r1).toBe('ONBOARDING_BLOCKED');
    expect(r2).toBe('ONBOARDING_BLOCKED');
    expect(r3).toBe('ONBOARDING_BLOCKED');
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('maps READY to passed run-history status', () => {
    const evaluator = makeEvaluator();
    expect(evaluator.toRunHistoryStatus('READY')).toBe('passed');
  });

  it('maps ONBOARDING_BLOCKED to blocked run-history status', () => {
    const evaluator = makeEvaluator();
    expect(evaluator.toRunHistoryStatus('ONBOARDING_BLOCKED')).toBe('blocked');
  });

  it('maps UNKNOWN to failed run-history status', () => {
    const evaluator = makeEvaluator();
    expect(evaluator.toRunHistoryStatus('UNKNOWN')).toBe('failed');
  });
});
