import { describe, expect, it, vi } from 'vitest';

import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import { ExecutionPlanPlannerService } from '../src/application/services/execution-plan-planner.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import { PlanBuildTool } from '../src/application/tools/built-in/build_execution_plan.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
});

const plan = {
  schemaVersion: 'execution-plan.v1',
  planId: 'plan-1',
  version: 1,
  goal: 'Smoke',
  mode: 'HYBRID_GUARDED',
  runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
  steps: [{
    id: 'S001',
    description: 'Wait for stable UI',
    preconditions: [],
    action: { type: 'waitForStable', reason: 'wait for stable UI' },
    postconditions: [{ type: 'text_visible', text: 'Inbox' }],
    assertions: [],
    onFailure: 'RECOVER',
  }],
  assertions: [],
};

const observation = {
  observationId: 'obs-1',
  createdAt: new Date().toISOString(),
  url: 'https://app.local/inbox',
  title: 'Inbox',
  visibleTexts: ['Inbox'],
  elements: [],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
};

const scenarios: QaScenario[] = [{
  id: 'scenario-001',
  title: 'Smoke',
  status: 'PLANNED',
  intent: 'POSITIVE',
  tasks: [{ id: 'T001', title: 'Verificar menu da conta', expected: 'Menu visível', status: 'PENDING', intent: 'POSITIVE' }],
}];

describe('qa.plan.build', () => {
  it('delegates to ExecutionPlanPlannerService and returns plan metadata', async () => {
    const planner = {
      build: vi.fn(async () => ({ plan, source: 'llm' })),
    };
    const browser = { execute: vi.fn(), observe: vi.fn() };
    const planExecutor = { execute: vi.fn() };
    const registry = new QaToolRegistry([PlanBuildTool]);

    await expect(registry.execute('qa.plan.build', {
      config,
      scenarios: [],
      memoryContext: { hints: ['prefer inbox labels'] },
      demandContext: { source: 'pr' },
      screenObservation: observation,
      runtimeMode: 'HYBRID_GUARDED',
    }, {
      metadata: { executionPlanPlanner: planner, browser, planExecutor },
    })).resolves.toEqual({
      ok: true,
      issues: [],
      result: {
        plan,
        planSource: 'llm',
        fallbackReason: undefined,
        fallbackWarning: undefined,
        memoryContext: { hints: ['prefer inbox labels'] },
      },
    });
    expect(planner.build).toHaveBeenCalledWith(config, []);
    expect(browser.execute).not.toHaveBeenCalled();
    expect(browser.observe).not.toHaveBeenCalled();
    expect(planExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns fallback metadata when planner falls back to factory', async () => {
    const planner = {
      build: vi.fn(async () => ({
        plan,
        source: 'factory',
        fallbackReason: 'LLM buildPlan returned invalid ExecutionPlan (1 schema issues: steps.0.action: Invalid input)',
      })),
    };
    const registry = new QaToolRegistry([PlanBuildTool]);

    await expect(registry.execute('qa.plan.build', { config, scenarios: [] }, {
      metadata: { executionPlanPlanner: planner },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        plan,
        planSource: 'factory',
        fallbackReason: expect.stringContaining('invalid ExecutionPlan'),
        fallbackWarning: 'LLM buildPlan failed schema/provider validation; safe factory fallback was used.',
      },
    });
  });

  it('preserves fallbackWarning returned by ExecutionPlanPlannerService wrapper', async () => {
    const planner = {
      build: vi.fn(async () => ({
        plan,
        source: 'factory',
        fallbackReason: 'LLM buildPlan returned invalid ExecutionPlan',
        fallbackWarning: 'custom fallback warning from planner boundary',
      })),
    };
    const registry = new QaToolRegistry([PlanBuildTool]);

    await expect(registry.execute('qa.plan.build', { config, scenarios: [] }, {
      metadata: { executionPlanPlanner: planner },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        planSource: 'factory',
        fallbackReason: 'LLM buildPlan returned invalid ExecutionPlan',
        fallbackWarning: 'custom fallback warning from planner boundary',
      },
    });
  });

  it('uses the real ExecutionPlanPlannerService fallback factory instead of duplicating planner logic', async () => {
    const provider: DecisionProviderPort = {
      buildPlan: vi.fn(async () => ({
        planId: 'bad-plan',
        goal: 'Bad',
        steps: [{
          id: 'S001',
          description: 'Bad',
          action: { type: 'click', targetElementId: 'el_001', reason: 'bad' },
          postconditions: [{ type: 'text_visible', text: 'Inbox' }],
        }],
      }) as never),
      async decide() { throw new Error('not used'); },
    };
    const planner = new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService());
    const registry = new QaToolRegistry([PlanBuildTool]);

    await expect(registry.execute('qa.plan.build', { config, scenarios }, {
      metadata: { executionPlanPlanner: planner },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        plan: { planId: 'plan_D1' },
        planSource: 'factory',
        fallbackReason: expect.stringContaining('targetElementId'),
        fallbackWarning: 'LLM buildPlan failed schema/provider validation; safe factory fallback was used.',
      },
    });
    expect(provider.buildPlan).toHaveBeenCalledWith(config, scenarios);
  });

  it('rejects planner output that is not a valid ExecutionPlan', async () => {
    const planner = {
      build: vi.fn(async () => ({ plan: { planId: 'bad' }, source: 'llm' })),
    };
    const registry = new QaToolRegistry([PlanBuildTool]);

    await expect(registry.execute('qa.plan.build', { config, scenarios: [] }, {
      metadata: { executionPlanPlanner: planner },
    })).rejects.toThrow();
  });
});
