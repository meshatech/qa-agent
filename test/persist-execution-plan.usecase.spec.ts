import { describe, expect, it, vi } from 'vitest';
import { PersistExecutionPlanUseCase } from '../src/application/use-cases/persist-execution-plan.usecase.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';
import type { ExecutionPlan } from '../src/domain/schemas/execution-plan.schema.js';

function makeValidPlan(): ExecutionPlan {
  return {
    schemaVersion: 'execution-plan.v1',
    planId: 'plan_DEM-001',
    version: 1,
    goal: 'Test Demand',
    mode: 'HYBRID_GUARDED',
    runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' },
    steps: [
      {
        id: 'S001',
        description: 'Navigate to base',
        preconditions: [],
        action: { type: 'navigate', to: 'http://localhost:3000', reason: 'start' },
        postconditions: [{ type: 'no_console_errors' }],
        assertions: [],
        onFailure: 'RECOVER',
      },
    ],
    assertions: [],
  };
}

describe('PersistExecutionPlanUseCase', () => {
  it('validates and persists a valid execution plan', async () => {
    const repo: RunRepositoryPort = {
      writeJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunRepositoryPort;

    const useCase = new PersistExecutionPlanUseCase(repo);
    const plan = makeValidPlan();
    const result = await useCase.execute({ runDir: '/tmp/run-001', plan });

    expect(result).toEqual(plan);
    expect(repo.writeJson).toHaveBeenCalledWith('/tmp/run-001', 'execution-plan.json', plan);
  });

  it('throws when plan fails schema validation', async () => {
    const repo: RunRepositoryPort = {
      writeJson: vi.fn(),
    } as unknown as RunRepositoryPort;

    const useCase = new PersistExecutionPlanUseCase(repo);
    const invalidPlan = { invalid: true } as unknown as ExecutionPlan;

    await expect(useCase.execute({ runDir: '/tmp/run-001', plan: invalidPlan })).rejects.toThrow();
    expect(repo.writeJson).not.toHaveBeenCalled();
  });
});
