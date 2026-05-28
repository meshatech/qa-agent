import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ScenarioGeneratorService } from './scenario-generator.service.js';
import { ScenarioSelectorService } from './scenario-selector.service.js';

export interface ScenarioOrchestratorInput {
  config: RunConfig;
  requiredScenarios?: RequiredScenario[];
  scenarioChunks?: MemoryChunk[];
}

export interface ScenarioOrchestratorResult {
  scenarios: QaScenario[];
  selected: QaScenario[];
  generated: QaScenario[];
  uncoveredRequiredScenarios: string[];
  warnings: string[];
}

const MAX_TOTAL_SCENARIOS = 10;

@Injectable()
export class ScenarioOrchestratorService {
  constructor(
    @Inject(ScenarioSelectorService) private readonly selector: ScenarioSelectorService,
    @Inject(ScenarioGeneratorService) private readonly generator: ScenarioGeneratorService,
  ) {}

  async orchestrate(input: ScenarioOrchestratorInput): Promise<ScenarioOrchestratorResult> {
    const warnings: string[] = [];
    const selected: QaScenario[] = [];
    const generated: QaScenario[] = [];
    const uncoveredRequiredScenarios: string[] = [];

    const hasCatalog = input.requiredScenarios?.length && input.scenarioChunks?.length;

    if (!hasCatalog) {
      warnings.push('No required scenarios or catalog provided; falling back to full generator.');
      const generatorResult = await this.generator.generate({
        uncoveredRequiredScenarios: input.requiredScenarios ?? [],
        config: input.config,
      });
      warnings.push(...generatorResult.warnings);
      return {
        scenarios: this.limitScenarios(generatorResult.generated),
        selected: [],
        generated: generatorResult.generated,
        uncoveredRequiredScenarios: [],
        warnings,
      };
    }

    const selectorResult = this.selector.select({
      requiredScenarios: input.requiredScenarios!,
      scenarioChunks: input.scenarioChunks!,
    });

    warnings.push(...selectorResult.warnings);

    const matchedRequiredIds = new Set(selectorResult.metadata.map((m) => m.requiredId));
    selected.push(...selectorResult.selectedScenarios);

    for (const required of input.requiredScenarios!) {
      if (!matchedRequiredIds.has(required.id)) {
        uncoveredRequiredScenarios.push(required.id);
      }
    }

    if (uncoveredRequiredScenarios.length > 0) {
      warnings.push(
        `Uncovered required scenarios: ${uncoveredRequiredScenarios.join(', ')}. Generating via generator.`,
      );
      const uncovered = input.requiredScenarios!.filter((r) => uncoveredRequiredScenarios.includes(r.id));
      const generatorResult = await this.generator.generate({
        uncoveredRequiredScenarios: uncovered,
        config: input.config,
      });
      warnings.push(...generatorResult.warnings);
      generated.push(...generatorResult.generated);
    }

    const merged = this.deduplicateScenarios([...selected, ...generated]);

    return {
      scenarios: this.limitScenarios(merged),
      selected,
      generated,
      uncoveredRequiredScenarios,
      warnings,
    };
  }

  private deduplicateScenarios(scenarios: QaScenario[]): QaScenario[] {
    const seen = new Set<string>();
    return scenarios.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  private limitScenarios(scenarios: QaScenario[]): QaScenario[] {
    return scenarios.slice(0, MAX_TOTAL_SCENARIOS);
  }
}
