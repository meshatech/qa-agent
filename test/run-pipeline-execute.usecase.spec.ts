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
      { execute: vi.fn().mockResolvedValue(mockResult) } as any,
      { load: async () => MOCK_CONFIG } as any,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as any,
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
      { execute: vi.fn().mockResolvedValue(mockResult) } as any,
      { load: async () => MOCK_CONFIG } as any,
      { open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as any,
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
});
