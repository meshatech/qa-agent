import { describe, expect, it, vi } from 'vitest';
import { PersistGherkinScenariosUseCase } from '../src/application/use-cases/persist-gherkin-scenarios.usecase.js';
import { GherkinRendererService } from '../src/application/services/gherkin-renderer.service.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';
import type { SelectedScenariosArtifact } from '../src/domain/schemas/selected-scenarios-artifact.schema.js';

function makeArtifact(): SelectedScenariosArtifact {
  return {
    version: 1,
    generatedAt: '2026-05-28T10:00:00.000Z',
    source: 'scenario-orchestrator',
    scenarios: [
      {
        id: 'SCN-001',
        title: 'Login',
        tasks: [{ id: 'T001', title: 'Preencher credenciais', expected: 'Logado', status: 'PENDING' }],
        status: 'PLANNED',
      },
    ],
    selected: [
      {
        id: 'SCN-001',
        title: 'Login',
        tasks: [{ id: 'T001', title: 'Preencher credenciais', expected: 'Logado', status: 'PENDING' }],
        status: 'PLANNED',
      },
    ],
    generated: [],
    uncoveredRequiredScenarios: [],
    warnings: [],
    summary: { total: 1, selected: 1, generated: 0, uncovered: 0, truncated: false, maxScenarios: 5 },
  };
}

describe('PersistGherkinScenariosUseCase', () => {
  it('renders markdown and writes selected-scenarios.md via repository', async () => {
    const repo: RunRepositoryPort = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunRepositoryPort;

    const useCase = new PersistGherkinScenariosUseCase(new GherkinRendererService(), repo);
    const artifact = makeArtifact();
    const result = await useCase.execute({ runDir: '/tmp/run-001', artifact });

    expect(repo.writeFile).toHaveBeenCalledTimes(1);
    expect(repo.writeFile).toHaveBeenCalledWith('/tmp/run-001', 'selected-scenarios.md', expect.stringContaining('# Cenários Selecionados'));
    expect(result).toContain('# Cenários Selecionados');
  });

  it('returns rendered markdown', async () => {
    const repo: RunRepositoryPort = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunRepositoryPort;

    const useCase = new PersistGherkinScenariosUseCase(new GherkinRendererService(), repo);
    const artifact = makeArtifact();
    const result = await useCase.execute({ runDir: '/tmp/run-002', artifact });

    expect(result).toContain('```gherkin');
    expect(result).toContain('Feature: Login');
  });
});
