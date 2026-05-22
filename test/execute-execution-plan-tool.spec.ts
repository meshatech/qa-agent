import { describe, expect, it, vi } from 'vitest';

import { PlanExecuteTool } from '../src/application/tools/built-in/execute_execution_plan.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
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
    preconditions: [{ type: 'text_visible', text: 'Home' }],
    action: { type: 'waitForStable', reason: 'wait for stable UI' },
    postconditions: [{ type: 'text_visible', text: 'Inbox' }],
    assertions: [{ type: 'no_console_errors' }],
    onFailure: 'RECOVER',
  }],
  assertions: [],
};

describe('qa.plan.execute', () => {
  it('delegates a validated ExecutionPlan to PlanExecutorService and returns structured output', async () => {
    const executionResult = {
      ok: true,
      steps: [],
      attempts: [],
      warnings: [{ stepId: 'S001', message: 'QUIESCENCE_TIMEOUT' }],
      finalPlan: plan,
      patchHistory: [],
      evaluations: [],
    };
    const planExecutor = {
      execute: vi.fn(async () => executionResult),
    };
    const registry = new QaToolRegistry([PlanExecuteTool]);

    await expect(registry.execute('qa.plan.execute', {
      plan,
      runConfig: config,
      scenarioId: 'scenario-001',
      outputConfig: { runDir: '.agent-qa/runs/run-1' },
      planRef: { runDir: '.agent-qa/runs/run-1', planId: 'plan-1' },
    }, {
      metadata: { planExecutor },
    })).resolves.toEqual({
      ok: true,
      issues: [],
      result: {
        executionResult,
        scenarioFinalStatus: 'PASSED',
        warnings: executionResult.warnings,
        bugs: [],
        artifacts: {
          scenarioId: 'scenario-001',
          outputConfig: { runDir: '.agent-qa/runs/run-1' },
          planRef: { runDir: '.agent-qa/runs/run-1', planId: 'plan-1' },
        },
        executionLogPath: '.agent-qa/runs/run-1/execution-log.json',
      },
    });
    expect(planExecutor.execute).toHaveBeenCalledWith(plan, config);
  });

  it('rejects action-only input before reaching PlanExecutorService', async () => {
    const planExecutor = { execute: vi.fn() };
    const registry = new QaToolRegistry([PlanExecuteTool]);

    await expect(registry.execute('qa.plan.execute', {
      action: { type: 'click', targetElementId: 'el_001', reason: 'unsafe action' },
    }, {
      metadata: { planExecutor },
    })).rejects.toThrow();
    expect(planExecutor.execute).not.toHaveBeenCalled();
  });

  it('does not expose or call PlaywrightHarness/page directly', async () => {
    const planExecutor = {
      execute: vi.fn(async () => ({
        ok: false,
        steps: [],
        attempts: [],
        warnings: [],
        finalPlan: plan,
        patchHistory: [],
        evaluations: [],
        failedStep: { id: 'S001' },
      })),
    };
    const playwrightHarness = { execute: vi.fn(), page: {} };
    const registry = new QaToolRegistry([PlanExecuteTool]);
    const result = await registry.execute('qa.plan.execute', { plan, config }, {
      metadata: { planExecutor, playwrightHarness },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        scenarioFinalStatus: 'FAILED',
        bugs: [{ id: 'S001' }],
      },
    });
    expect(playwrightHarness.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('page');
  });
});
