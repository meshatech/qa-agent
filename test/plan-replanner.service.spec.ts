import { describe, expect, it } from 'vitest';
import { PlanReplannerService } from '../src/application/services/plan-replanner.service.js';
import { PlanPatchApplierService } from '../src/application/services/plan-patch-applier.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { DomainError } from '../src/domain/shared/result.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { ExecutionPlan, PlanPatch } from '../src/domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import type { QaActionEnvelope } from '../src/domain/schemas/action.schema.js';

const mockPlan: ExecutionPlan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'plan_test',
  version: 1,
  goal: 'Test',
  mode: 'PLAN_AND_EXECUTE',
  runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
  steps: [],
  assertions: [],
};

const mockConfig = { baseUrl: 'https://app.local' } as RunConfig;

const mockObservation: ScreenObservation = {
  observationId: 'obs_1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/',
  title: 'App',
  visibleTexts: [],
  elements: [],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

const mockFailedStep = {
  id: 'S1',
  scenarioId: 'sc1',
  taskId: 't1',
  description: 'Test step',
  preconditions: [] as never[],
  action: { type: 'waitForStable' as const, timeoutMs: 1000, reason: 'wait' },
  postconditions: [] as never[],
  assertions: [] as never[],
  onFailure: 'RECOVER' as const,
};

const mockEnvelope: QaActionEnvelope = {
  schemaVersion: 'action.v1',
  observationId: 'obs_1',
  thought_summary: 'test',
  action: { type: 'waitForStable', timeoutMs: 1000, reason: 'wait' },
  expected_after_action: { type: 'no_console_errors' },
  fallback_action: { type: 'waitForStable', timeoutMs: 1000, reason: 'fallback' },
  confidence: 0.9,
};

function makeDecision(overrides: Partial<DecisionProviderPort> = {}): DecisionProviderPort {
  return {
    decide: async () => mockEnvelope,
    ...overrides,
  };
}

describe('PlanReplannerService', () => {
  it('throws when decision provider lacks replan', async () => {
    const decision = makeDecision();
    const applier = new PlanPatchApplierService(new ActionPolicyService());
    const service = new PlanReplannerService(decision, applier);
    await expect(service.replan({
      plan: mockPlan,
      failedStep: mockFailedStep,
      observation: mockObservation,
      reason: 'LOCATOR_NOT_FOUND',
      message: 'Element not found',
      history: [],
      runData: {},
      config: mockConfig,
    })).rejects.toThrow(DomainError);
  });

  it('replans using decision provider and applies patch', async () => {
    const patch: PlanPatch = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'mark_blocked',
      reason: 'Element not found',
      replanReason: 'LOCATOR_NOT_FOUND',
      steps: [],
    };

    const decision = makeDecision({
      async replan() { return patch; },
    });
    const applier = new PlanPatchApplierService(new ActionPolicyService());
    const service = new PlanReplannerService(decision, applier);

    const result = await service.replan({
      plan: mockPlan,
      failedStep: mockFailedStep,
      observation: mockObservation,
      reason: 'LOCATOR_NOT_FOUND',
      message: 'Element not found',
      history: [],
      runData: {},
      config: mockConfig,
    });

    expect(result.plan).toBeDefined();
    expect(result.history.status).toBe('BLOCKED');
  });

  it('validates raw patch before applying', () => {
    const decision = makeDecision();
    const applier = new PlanPatchApplierService(new ActionPolicyService());
    const service = new PlanReplannerService(decision, applier);

    const raw = {
      basePlanId: 'plan_test',
      basePlanVersion: 1,
      operation: 'mark_blocked',
      reason: 'Test',
      replanReason: 'PRECONDITION_FAILED',
      steps: [],
    };

    const result = service.apply(mockConfig, mockPlan, raw);
    expect(result.plan).toBeDefined();
    expect(result.history.status).toBe('BLOCKED');
  });

  it('validates patch with wrapped patches array', () => {
    const decision = makeDecision();
    const applier = new PlanPatchApplierService(new ActionPolicyService());
    const service = new PlanReplannerService(decision, applier);

    const raw = {
      patches: [{
        basePlanId: 'plan_test',
        basePlanVersion: 1,
        operation: 'mark_blocked',
        reason: 'Test',
        replanReason: 'PRECONDITION_FAILED',
        steps: [],
      }],
    };

    const validated = service.validatePatch(raw);
    expect(validated).toBeDefined();
  });
});
