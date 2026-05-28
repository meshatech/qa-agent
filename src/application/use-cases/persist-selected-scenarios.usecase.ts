import { Inject, Injectable } from '@nestjs/common';

import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { ScenarioOrchestratorResult } from '../services/scenario-orchestrator.service.js';
import {
  SelectedScenariosArtifactSchema,
  type SelectedScenariosArtifact,
} from '../../domain/schemas/selected-scenarios-artifact.schema.js';

@Injectable()
export class PersistSelectedScenariosUseCase {
  constructor(
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
  ) {}

  async execute(input: {
    runDir: string;
    result: ScenarioOrchestratorResult;
    maxScenarios: number;
  }): Promise<SelectedScenariosArtifact> {
    const { runDir, result, maxScenarios } = input;

    const allIds = new Set<string>();
    for (const s of result.selected) allIds.add(s.id);
    for (const s of result.generated) allIds.add(s.id);
    const truncated = result.scenarios.length < allIds.size;

    const artifact: SelectedScenariosArtifact = {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: 'scenario-orchestrator',
      scenarios: result.scenarios,
      selected: result.selected,
      generated: result.generated,
      uncoveredRequiredScenarios: result.uncoveredRequiredScenarios,
      warnings: result.warnings,
      summary: {
        total: result.scenarios.length,
        selected: result.selected.length,
        generated: result.generated.length,
        uncovered: result.uncoveredRequiredScenarios.length,
        truncated,
        maxScenarios,
      },
    };

    SelectedScenariosArtifactSchema.parse(artifact);
    await this.repo.writeJson(runDir, 'selected-scenarios.json', artifact);

    return artifact;
  }
}
