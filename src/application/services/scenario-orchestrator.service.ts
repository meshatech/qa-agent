import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ScenarioGeneratorService } from './scenario-generator.service.js';
import { ScenarioSelectorService, type ScenarioMatch } from './scenario-selector.service.js';

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
    const maxScenarios = input.config.scenarioSelection.maxScenarios;

    const hasCatalog = input.requiredScenarios?.length && input.scenarioChunks?.length;

    if (!hasCatalog) {
      warnings.push('No required scenarios or catalog provided; falling back to full generator.');
      const generatorResult = await this.generator.generate({
        uncoveredRequiredScenarios: input.requiredScenarios ?? [],
        config: input.config,
      });
      warnings.push(...generatorResult.warnings);
      const { limited, removedCount } = this.applyScenarioLimit(
        [],
        generatorResult.generated,
        [],
        maxScenarios,
      );
      if (removedCount > 0) {
        warnings.push(
          `Scenario limit applied: kept ${limited.length} scenarios using maxScenarios=${maxScenarios}; removed ${removedCount}.`,
        );
      }
      return {
        scenarios: limited,
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

    const { limited, removedCount } = this.applyScenarioLimit(
      selected,
      generated,
      selectorResult.metadata,
      maxScenarios,
    );

    if (removedCount > 0) {
      warnings.push(
        `Scenario limit applied: kept ${limited.length} scenarios using maxScenarios=${maxScenarios}; removed ${removedCount}.`,
      );
    }

    return {
      scenarios: limited,
      selected,
      generated,
      uncoveredRequiredScenarios,
      warnings,
    };
  }

  private applyScenarioLimit(
    selected: QaScenario[],
    generated: QaScenario[],
    selectedMatches: ScenarioMatch[],
    maxScenarios: number,
  ): { limited: QaScenario[]; removedCount: number } {
    const seen = new Set<string>();
    const uniqueSelected: QaScenario[] = [];

    for (const s of selected) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        uniqueSelected.push(s);
      }
    }

    const uniqueGenerated: QaScenario[] = [];
    for (const g of generated) {
      if (!seen.has(g.id)) {
        uniqueGenerated.push(g);
      }
    }

    const scoreMap = new Map<string, number>();
    for (const match of selectedMatches) {
      const existing = scoreMap.get(match.matchedChunkId) ?? 0;
      scoreMap.set(match.matchedChunkId, Math.max(existing, match.score));
    }

    const sortedSelected = [...uniqueSelected].sort((a, b) => {
      const scoreA = scoreMap.get(a.id) ?? 0;
      const scoreB = scoreMap.get(b.id) ?? 0;
      return scoreB - scoreA;
    });

    const combined = [...sortedSelected, ...uniqueGenerated];
    const limited = combined.slice(0, maxScenarios);
    const removedCount = combined.length - limited.length;

    return { limited, removedCount };
  }
}
