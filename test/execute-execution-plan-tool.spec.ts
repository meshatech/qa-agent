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

  it('does not run a parallel execution loop for conditions, quiescence, policies, or replan', async () => {
    const executionResult = {
      ok: true,
      steps: [{
        stepId: 'S001',
        action: plan.steps[0]?.action,
        resolvedAction: plan.steps[0]?.action,
        boundExpected: { type: 'text_visible', text: 'Inbox' },
        validation: { ok: true, type: 'text_visible', durationMs: 0 },
      }],
      attempts: [{ actionType: 'waitForStable', result: 'PASSED', ts: '2026-05-22T00:00:00.000Z' }],
      warnings: [{ stepId: 'S001', message: 'QUIESCENCE_TIMEOUT' }],
      finalPlan: plan,
      patchHistory: [{ status: 'BLOCKED', reason: 'no safe patch' }],
      evaluations: [
        { conditionId: 'S001:precondition:1', stepId: 'S001', phase: 'precondition', type: 'text_visible', passed: true, severity: 'INFO', reason: 'condition passed' },
        { conditionId: 'S001:postcondition:1', stepId: 'S001', phase: 'postcondition', type: 'text_visible', passed: true, severity: 'INFO', reason: 'condition passed' },
        { conditionId: 'S001:businessAssertion:1', stepId: 'S001', phase: 'businessAssertion', type: 'no_console_errors', passed: true, severity: 'INFO', reason: 'condition passed' },
      ],
    };
    const planExecutor = { execute: vi.fn(async () => executionResult) };
    const browser = {
      observe: vi.fn(),
      execute: vi.fn(),
      waitForQuiescence: vi.fn(),
      validate: vi.fn(),
    };
    const locatorResolver = { findByLocator: vi.fn(), rebuild: vi.fn() };
    const actionPolicy = { validate: vi.fn(), validateDestructiveText: vi.fn() };
    const replanner = { replan: vi.fn() };
    const evidence = { record: vi.fn() };
    const registry = new QaToolRegistry([PlanExecuteTool]);

    await expect(registry.execute('qa.plan.execute', {
      plan,
      config,
      scenarioId: 'scenario-001',
    }, {
      metadata: { planExecutor, browser, locatorResolver, actionPolicy, replanner, evidence },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        executionResult: {
          warnings: executionResult.warnings,
          patchHistory: executionResult.patchHistory,
          evaluations: executionResult.evaluations,
        },
        scenarioFinalStatus: 'PASSED',
        warnings: executionResult.warnings,
      },
    });
    expect(planExecutor.execute).toHaveBeenCalledWith(plan, config);
    expect(browser.observe).not.toHaveBeenCalled();
    expect(browser.execute).not.toHaveBeenCalled();
    expect(browser.waitForQuiescence).not.toHaveBeenCalled();
    expect(browser.validate).not.toHaveBeenCalled();
    expect(locatorResolver.findByLocator).not.toHaveBeenCalled();
    expect(locatorResolver.rebuild).not.toHaveBeenCalled();
    expect(actionPolicy.validate).not.toHaveBeenCalled();
    expect(actionPolicy.validateDestructiveText).not.toHaveBeenCalled();
    expect(replanner.replan).not.toHaveBeenCalled();
    expect(evidence.record).not.toHaveBeenCalled();
  });
});
