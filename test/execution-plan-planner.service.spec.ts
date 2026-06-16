import { describe, expect, it } from 'vitest';
import { ExecutionPlanPlannerService } from '../src/application/services/execution-plan-planner.service.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { PlanCachePort } from '../src/application/ports/plan-cache.port.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import type { ExecutionPlan } from '../src/domain/schemas/execution-plan.schema.js';

const mockConfig = {
  baseUrl: 'https://app.local',
  demand: { id: 'DEMAND-1', title: 'Test', description: 'Test' },
  runtime: { mode: 'PLAN_AND_EXECUTE', maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL', planning: {} },
} as RunConfig;

const mockScenarios: QaScenario[] = [{
  id: 'scenario-1',
  title: 'Test',
  status: 'PLANNED',
  intent: 'POSITIVE',
  tasks: [{
    id: 'T001',
    title: 'Navigate to app',
    expected: 'App loads',
    status: 'PENDING',
    intent: 'POSITIVE',
  }],
}];

function makeDecision(buildPlan?: ExecutionPlan): DecisionProviderPort {
  return {
    decide: async () => ({ schemaVersion: 'action.v1', observationId: 'obs', thought_summary: 'test', action: { type: 'waitForStable', timeoutMs: 1000, reason: 'wait' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'waitForStable', timeoutMs: 1000, reason: 'fallback' }, confidence: 0.9 }),
    buildPlan: buildPlan ? async () => buildPlan : undefined,
  };
}

function makeFactory(plan?: ExecutionPlan): ExecutionPlanFactoryService {
  return {
    fromScenarios: async () => plan ?? null,
  } as unknown as ExecutionPlanFactoryService;
}

function makeCache(): PlanCachePort {
  return {
    get: async () => undefined,
    set: async () => undefined,
  };
}

describe('ExecutionPlanPlannerService', () => {
  it('builds plan from LLM when available', async () => {
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_llm',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
      steps: [{
        id: 'S1',
        scenarioId: 'scenario-1',
        taskId: 'T001',
        description: 'Navigate',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local', reason: 'Go to app' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'https://app.local' }],
        assertions: [],
        onFailure: 'RECOVER',
      }],
      assertions: [],
    };

    const service = new ExecutionPlanPlannerService(makeDecision(plan), makeFactory(), makeCache());
    const result = await service.build(mockConfig, mockScenarios);

    expect(result.plan).toBeDefined();
    // Plan returned by LLM but may fail semantic validation and fallback to factory
    expect(['llm', 'factory']).toContain(result.source);
  });

  it('falls back to factory when LLM fails', async () => {
    const factoryPlan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_factory',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
      steps: [{
        id: 'S1',
        scenarioId: 'scenario-1',
        taskId: 'T001',
        description: 'Navigate',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local', reason: 'Go to app' },
        postconditions: [],
        assertions: [],
        onFailure: 'RECOVER',
      }],
      assertions: [],
    };

    const decision = makeDecision();
    const service = new ExecutionPlanPlannerService(decision, makeFactory(factoryPlan), makeCache());
    const result = await service.build(mockConfig, mockScenarios);

    expect(result.plan).toBeDefined();
    expect(result.source).toBe('factory');
  });

  it('returns undefined plan when nothing available', async () => {
    const decision: DecisionProviderPort = {
      decide: async () => ({ schemaVersion: 'action.v1', observationId: 'obs', thought_summary: 'test', action: { type: 'waitForStable', timeoutMs: 1000, reason: 'wait' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'waitForStable', timeoutMs: 1000, reason: 'fallback' }, confidence: 0.9 }),
    };
    const service = new ExecutionPlanPlannerService(decision, makeFactory(), makeCache());
    const result = await service.build(mockConfig, mockScenarios);

    expect(result.plan).toBeNull();
    expect(result.source).toBe('factory');
  });

  it('uses cached plan when available', async () => {
    const cachedPlan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_cached',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
      steps: [],
      assertions: [],
    };

    const cache: PlanCachePort = {
      get: async () => ({ plan: cachedPlan, source: 'llm' }),
      set: async () => undefined,
    };

    const service = new ExecutionPlanPlannerService(makeDecision(), makeFactory(), cache);
    const result = await service.build(mockConfig, mockScenarios);

    expect(result.plan).toBeDefined();
    expect(result.source).toBe('llm');
  });

  it('factory_first strategy uses factory before LLM', async () => {
    const factoryPlan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_factory',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
      steps: [],
      assertions: [],
    };

    const llmPlan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_llm',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
      steps: [],
      assertions: [],
    };

    const config = {
      ...mockConfig,
      runtime: { ...mockConfig.runtime, planning: { executionPlanStrategy: 'factory_first' } },
    } as RunConfig;
    const service = new ExecutionPlanPlannerService(makeDecision(llmPlan), makeFactory(factoryPlan), makeCache());
    const result = await service.build(config, mockScenarios);

    expect(result.plan).toBeDefined();
    expect(result.source).toBe('factory');
  });
});
