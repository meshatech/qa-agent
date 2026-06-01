import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineExecuteUseCase } from '../src/application/use-cases/run-pipeline-execute.usecase.js';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
import type { PlanExecutionResult } from '../src/application/services/plan-executor.service.js';

const MOCK_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173/',
  appDomains: ['127.0.0.1'],
  demand: { id: 'PRJ-TEST', title: 'Test', description: 'Test desc' },
  auth: { kind: 'none' as const },
  llm: { provider: 'fake' as const },
  runtime: {
    mode: 'HYBRID_GUARDED' as const,
    maxAttemptsPerStep: 2,
    maxReplansPerScenario: 2,
    destructiveActionPolicy: 'BLOCK' as const,
    planning: { executionPlanStrategy: 'factory_first' as const },
    elementAvailability: { enabled: true, maxOpenAttempts: 3, allowClickOutside: true, allowGlobalEscape: true, allowedContainers: [] },
  },
  recovery: { maxFallbacksPerStep: 2, maxEmergencyActionsPerScenario: 1 },
  timeouts: { quiescenceMs: 5000, assertionMs: 5000, navigationMs: 10000 },
};

const MOCK_PLAN = ExecutionPlanSchema.parse({
  schemaVersion: 'execution-plan.v1',
  planId: 'plan_test',
  version: 1,
  goal: 'Test',
  mode: 'HYBRID_GUARDED',
  runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
  steps: [
    {
      id: 'S001',
      description: 'Navigate to home',
      preconditions: [],
      action: { type: 'navigate', to: 'http://127.0.0.1:4173/', reason: 'open home' },
      postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'http://127.0.0.1:4173/' }],
      assertions: [],
      onFailure: 'BLOCK',
    },
  ],
  assertions: [],
});

async function setupTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-execute-'));
  await writeFile(join(dir, 'execution-plan.json'), JSON.stringify(MOCK_PLAN), 'utf8');
  await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');
  return dir;
}

describe('RunPipelineExecuteUseCase', () => {
  it('executes plan and returns result summary', async () => {
    const dir = await setupTempDir();

    const mockResult: PlanExecutionResult = {
      ok: true,
      steps: [
        {
          stepId: 'S001',
          action: { type: 'navigate', to: 'http://127.0.0.1:4173/', reason: 'open home' },
          resolvedAction: { type: 'navigate', to: 'http://127.0.0.1:4173/', reason: 'open home' },
          boundExpected: { type: 'no_console_errors' },
          validation: { ok: true, type: 'route_state', durationMs: 1 },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
      attempts: [{ actionType: 'navigate', result: 'PASSED', ts: new Date().toISOString() }],
      warnings: [],
      finalPlan: MOCK_PLAN,
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [
        { stepId: 'S001', type: 'deterministic_resolution', timestamp: new Date().toISOString() },
      ],
    };

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockResolvedValue(mockResult) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.ok).toBe(true);
    expect(result.stepsExecuted).toBe(1);
    expect(result.stepsPassed).toBe(1);
    expect(result.stepsFailed).toBe(0);
    expect(result.telemetrySummary.deterministicResolutions).toBe(1);
    expect(result.executionResultPath).toBeDefined();

    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes telemetry correctly', async () => {
    const dir = await setupTempDir();

    const mockResult: PlanExecutionResult = {
      ok: false,
      steps: [],
      attempts: [],
      warnings: [{ stepId: 'S001', message: 'Navigation timeout' }],
      finalPlan: MOCK_PLAN,
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [
        { stepId: 'S001', type: 'semantic_fallback', timestamp: new Date().toISOString() },
        { stepId: 'S002', type: 'llm_decide', timestamp: new Date().toISOString() },
        { stepId: 'S003', type: 'replan', timestamp: new Date().toISOString() },
        { stepId: 'S004', type: 'target_not_found', timestamp: new Date().toISOString() },
      ],
      failedMessage: 'Navigation timeout',
    };

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockResolvedValue(mockResult) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.ok).toBe(false);
    expect(result.telemetrySummary.semanticFallbacks).toBe(1);
    expect(result.telemetrySummary.llmDecides).toBe(1);
    expect(result.telemetrySummary.replans).toBe(1);
    expect(result.telemetrySummary.targetsNotFound).toBe(1);
    expect(result.warningsCount).toBe(1);
    expect(result.failedMessage).toBe('Navigation timeout');

    await rm(dir, { recursive: true, force: true });
  });

  it('counts passed and failed steps correctly', async () => {
    const dir = await setupTempDir();

    const mockResult: PlanExecutionResult = {
      ok: false,
      steps: [
        {
          stepId: 'S001',
          action: { type: 'navigate', to: 'http://example.com', reason: 'test' },
          resolvedAction: { type: 'navigate', to: 'http://example.com', reason: 'test' },
          boundExpected: { type: 'no_console_errors' },
          validation: { ok: true, type: 'no_console_errors', durationMs: 1 },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        {
          stepId: 'S002',
          action: { type: 'click', targetElementId: 'el_001', reason: 'test' },
          resolvedAction: { type: 'click', targetElementId: 'el_001', reason: 'test' },
          boundExpected: { type: 'no_console_errors' },
          validation: { ok: false, type: 'element_visible', durationMs: 1 },
          error: { code: 'LOCATOR_NOT_FOUND', message: 'Not found' },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        {
          stepId: 'S003',
          action: { type: 'fill', targetElementId: 'el_002', value: 'x', reason: 'test' },
          resolvedAction: { type: 'fill', targetElementId: 'el_002', value: 'x', reason: 'test' },
          boundExpected: { type: 'no_console_errors' },
          // no validation, no error
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
      attempts: [],
      warnings: [],
      finalPlan: MOCK_PLAN,
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [],
    };

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockResolvedValue(mockResult) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.stepsExecuted).toBe(3);
    expect(result.stepsPassed).toBe(1); // only S001 (ok=true, no error)
    expect(result.stepsFailed).toBe(2); // S002 (error), S003 (no validation.ok)

    await rm(dir, { recursive: true, force: true });
  });

  it('closes browser even when execution throws', async () => {
    const dir = await setupTempDir();
    const closeMock = vi.fn().mockResolvedValue(undefined);

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockRejectedValue(new Error('Execution exploded')) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: closeMock } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    await expect(useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') })).rejects.toThrow('Execution exploded');
    expect(closeMock).toHaveBeenCalledTimes(1);

    await rm(dir, { recursive: true, force: true });
  });

  it('closes browser even when open throws', async () => {
    const dir = await setupTempDir();
    const closeMock = vi.fn().mockResolvedValue(undefined);

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn() } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockRejectedValue(new Error('Browser launch failed')), close: closeMock } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    await expect(useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') })).rejects.toThrow('Browser launch failed');
    expect(closeMock).toHaveBeenCalledTimes(1);

    await rm(dir, { recursive: true, force: true });
  });

  it('returns zero counts when no steps executed', async () => {
    const dir = await setupTempDir();

    const mockResult: PlanExecutionResult = {
      ok: true,
      steps: [],
      attempts: [],
      warnings: [],
      finalPlan: MOCK_PLAN,
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [],
    };

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockResolvedValue(mockResult) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.stepsExecuted).toBe(0);
    expect(result.stepsPassed).toBe(0);
    expect(result.stepsFailed).toBe(0);
    expect(result.warningsCount).toBe(0);

    await rm(dir, { recursive: true, force: true });
  });

  it('handles empty telemetry gracefully', async () => {
    const dir = await setupTempDir();

    const mockResult: PlanExecutionResult = {
      ok: true,
      steps: [
        {
          stepId: 'S001',
          action: { type: 'navigate', to: 'http://example.com', reason: 'test' },
          resolvedAction: { type: 'navigate', to: 'http://example.com', reason: 'test' },
          boundExpected: { type: 'no_console_errors' },
          validation: { ok: true, type: 'no_console_errors', durationMs: 1 },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
      attempts: [],
      warnings: [],
      finalPlan: MOCK_PLAN,
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [],
    };

    const useCase = new RunPipelineExecuteUseCase(
      { execute: vi.fn().mockResolvedValue(mockResult) } as unknown as import('../src/application/services/plan-executor.service.js').PlanExecutorService,
      { load: async () => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as import('../src/application/ports/browser-harness.port.js').BrowserHarnessPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.telemetrySummary.deterministicResolutions).toBe(0);
    expect(result.telemetrySummary.semanticFallbacks).toBe(0);
    expect(result.telemetrySummary.llmDecides).toBe(0);
    expect(result.telemetrySummary.replans).toBe(0);
    expect(result.telemetrySummary.targetsNotFound).toBe(0);

    await rm(dir, { recursive: true, force: true });
  });
});
