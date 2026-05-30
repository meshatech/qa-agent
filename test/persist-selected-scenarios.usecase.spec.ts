import { describe, expect, it, vi } from 'vitest';
import { PersistSelectedScenariosUseCase } from '../src/application/use-cases/persist-selected-scenarios.usecase.js';
import type { ScenarioOrchestratorResult } from '../src/application/services/scenario-orchestrator.service.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';
import type { QaScenario } from '../src/domain/schemas/qa-scenario.schema.js';

function makeScenario(id: string): QaScenario {
  return {
    id,
    title: `Scenario ${id}`,
    tasks: [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }],
    status: 'PLANNED',
  };
}

function makeRepo(): RunRepositoryPort {
  return {
    createRunDir: vi.fn(),
    ensureDir: vi.fn(),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn(),
    writeReport: vi.fn(),
    findRunDir: vi.fn(),
    readJson: vi.fn(),
    exists: vi.fn(),
    listFiles: vi.fn(),
    appendRunHistory: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
  };
}

describe('PersistSelectedScenariosUseCase', () => {
  it('persists artifact with all fields', async () => {
    const repo = makeRepo();
    const useCase = new PersistSelectedScenariosUseCase(repo);
    const result: ScenarioOrchestratorResult = {
      scenarios: [makeScenario('SCN-001')],
      selected: [makeScenario('SCN-001')],
      generated: [],
      uncoveredRequiredScenarios: [],
      warnings: [],
    };

    const artifact = await useCase.execute({ runDir: '/run/1', result, maxScenarios: 5 });

    expect(repo.writeJson).toHaveBeenCalledTimes(1);
    expect(repo.writeJson).toHaveBeenCalledWith('/run/1', 'selected-scenarios.json', expect.any(Object));
    expect(artifact.version).toBe(1);
    expect(artifact.source).toBe('scenario-orchestrator');
    expect(artifact.scenarios).toHaveLength(1);
    expect(artifact.summary.total).toBe(1);
    expect(artifact.summary.selected).toBe(1);
    expect(artifact.summary.generated).toBe(0);
    expect(artifact.summary.uncovered).toBe(0);
    expect(artifact.summary.maxScenarios).toBe(5);
  });

  it('computes summary correctly with selected and generated', async () => {
    const repo = makeRepo();
    const useCase = new PersistSelectedScenariosUseCase(repo);
    const result: ScenarioOrchestratorResult = {
      scenarios: [makeScenario('SCN-001'), makeScenario('SCN-002')],
      selected: [makeScenario('SCN-001')],
      generated: [makeScenario('SCN-002')],
      uncoveredRequiredScenarios: ['REQ-003'],
      warnings: ['Some warning'],
    };

    const artifact = await useCase.execute({ runDir: '/run/1', result, maxScenarios: 5 });

    expect(artifact.summary.total).toBe(2);
    expect(artifact.summary.selected).toBe(1);
    expect(artifact.summary.generated).toBe(1);
    expect(artifact.summary.uncovered).toBe(1);
  });

  it('sets truncated=true when scenarios were cut', async () => {
    const repo = makeRepo();
    const useCase = new PersistSelectedScenariosUseCase(repo);
    const result: ScenarioOrchestratorResult = {
      scenarios: [makeScenario('SCN-001')],
      selected: [makeScenario('SCN-001'), makeScenario('SCN-002')],
      generated: [makeScenario('SCN-003')],
      uncoveredRequiredScenarios: [],
      warnings: [],
    };

    const artifact = await useCase.execute({ runDir: '/run/1', result, maxScenarios: 2 });

    expect(artifact.summary.truncated).toBe(true);
  });

  it('sets truncated=false when no cut happened', async () => {
    const repo = makeRepo();
    const useCase = new PersistSelectedScenariosUseCase(repo);
    const result: ScenarioOrchestratorResult = {
      scenarios: [makeScenario('SCN-001')],
      selected: [makeScenario('SCN-001')],
      generated: [],
      uncoveredRequiredScenarios: [],
      warnings: [],
    };

    const artifact = await useCase.execute({ runDir: '/run/1', result, maxScenarios: 5 });

    expect(artifact.summary.truncated).toBe(false);
  });

  it('handles deduplication in truncation detection', async () => {
    const repo = makeRepo();
    const useCase = new PersistSelectedScenariosUseCase(repo);
    const duplicate = makeScenario('SCN-001');
    const result: ScenarioOrchestratorResult = {
      scenarios: [duplicate],
      selected: [duplicate],
      generated: [duplicate],
      uncoveredRequiredScenarios: [],
      warnings: [],
    };

    const artifact = await useCase.execute({ runDir: '/run/1', result, maxScenarios: 5 });

    expect(artifact.summary.truncated).toBe(false);
    expect(artifact.summary.total).toBe(1);
  });
});
