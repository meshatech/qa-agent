import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineGeneratePlanUseCase } from '../src/application/use-cases/run-pipeline-generate-plan.usecase.js';
import { ExecutionPlanPlannerService } from '../src/application/services/execution-plan-planner.service.js';
import { SelectedScenariosSchema } from '../src/domain/schemas/selected-scenarios.schema.js';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
import type { QaScenario } from '../src/domain/models/run.model.js';

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
  },
};

const MOCK_SCENARIOS: QaScenario[] = [
  {
    id: 'SC-TEST-001',
    title: 'Test scenario',
    status: 'PLANNED',
    intent: 'POSITIVE',
    tasks: [
      {
        id: 'T001',
        title: 'Navigate to home',
        expected: 'Page loads',
        status: 'PENDING',
        intent: 'POSITIVE',
      },
    ],
  },
];

async function setupTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-generate-plan-'));
  const selected = SelectedScenariosSchema.parse({
    schemaVersion: 'selected-scenarios.v1',
    generatedAt: new Date().toISOString(),
    count: MOCK_SCENARIOS.length,
    scenarios: MOCK_SCENARIOS,
  });
  await writeFile(join(dir, 'selected-scenarios.json'), JSON.stringify(selected), 'utf8');
  await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');
  return dir;
}

describe('RunPipelineGeneratePlanUseCase', () => {
  it('generates execution-plan.json from selected-scenarios.json', async () => {
    const dir = await setupTempDir();
    const useCase = new RunPipelineGeneratePlanUseCase(
      new ExecutionPlanPlannerService(
        { buildPlan: undefined } as unknown as import('../src/application/ports/decision-provider.port.js').DecisionProviderPort,
        { fromScenarios: async () => ({ schemaVersion: 'execution-plan.v1', planId: 'plan_test', version: 1, goal: 'Test', mode: 'HYBRID_GUARDED', runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' }, steps: [{ id: 'step1', description: 'navigate', preconditions: [], action: { type: 'navigate', to: 'http://127.0.0.1:4173/', reason: 'test' }, postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'http://127.0.0.1:4173/' }] }], assertions: [] }) } as unknown as import('../src/application/services/execution-plan-factory.service.js').ExecutionPlanFactoryService,
      ),
      { load: async (_path: string) => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.executionPlanPath).toBeDefined();
    expect(result.planSource).toBeDefined();
    expect(result.qualityAudit).toBeDefined();

    const planRaw = await import('node:fs/promises').then((m) => m.readFile(result.executionPlanPath!, 'utf8'));
    const plan = ExecutionPlanSchema.parse(JSON.parse(planRaw));
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.metadata?.planSource).toBeDefined();

    await rm(dir, { recursive: true, force: true });
  });

  it('warns when selected-scenarios.json is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-generate-plan-'));
    const selected = SelectedScenariosSchema.parse({
      schemaVersion: 'selected-scenarios.v1',
      generatedAt: new Date().toISOString(),
      count: 0,
      scenarios: [],
    });
    await writeFile(join(dir, 'selected-scenarios.json'), JSON.stringify(selected), 'utf8');
    await writeFile(join(dir, 'agent-qa.config.json'), JSON.stringify(MOCK_CONFIG), 'utf8');

    const useCase = new RunPipelineGeneratePlanUseCase(
      new ExecutionPlanPlannerService({ buildPlan: undefined } as unknown as import('../src/application/ports/decision-provider.port.js').DecisionProviderPort, { fromScenarios: async () => undefined } as unknown as import('../src/application/services/execution-plan-factory.service.js').ExecutionPlanFactoryService),
      { load: async (_path: string) => MOCK_CONFIG } as unknown as import('../src/application/ports/config-loader.port.js').ConfigLoaderPort,
    );

    const result = await useCase.execute(dir, { configPath: join(dir, 'agent-qa.config.json') });

    expect(result.executionPlanPath).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);

    await rm(dir, { recursive: true, force: true });
  });
});
