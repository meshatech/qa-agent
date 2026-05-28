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

/**
 * Result of the scenario orchestration pipeline.
 *
 * - `scenarios`: scenarios effectively executed (post-limit)
 * - `selected`: all catalog-selected scenarios (pre-limit, for tracking)
 * - `generated`: scenarios produced by the generator for uncovered requirements
 * - `uncoveredRequiredScenarios`: IDs of required scenarios with no catalog match
 */
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
    const hasCatalog = input.requiredScenarios?.length && input.scenarioChunks?.length;
    const maxScenarios = input.config.scenarioSelection.maxScenarios;

    if (!hasCatalog) {
      return this.handleNoCatalogFallback(input, maxScenarios);
    }

    const { selected, warnings, uncoveredRequiredScenarios, selectorMetadata } =
      this.handleSelectorPhase(input);

    const generated = await this.handleGenerationPhase(input, uncoveredRequiredScenarios, warnings);

    const { limited, removedCount } = this.applyScenarioLimit(
      selected,
      generated,
      selectorMetadata,
      maxScenarios,
    );

    if (removedCount > 0) {
      warnings.push(
        `Scenario limit applied: kept ${limited.length} scenarios using maxScenarios=${maxScenarios}; removed ${removedCount}.`,
      );
    }

    return this.buildResult(limited, selected, generated, uncoveredRequiredScenarios, warnings);
  }

  private async handleNoCatalogFallback(
    input: ScenarioOrchestratorInput,
    maxScenarios: number,
  ): Promise<ScenarioOrchestratorResult> {
    const warnings: string[] = [
      'No required scenarios or catalog provided; falling back to full generator.',
    ];
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

    return this.buildResult(limited, [], generatorResult.generated, [], warnings);
  }

  private handleSelectorPhase(input: ScenarioOrchestratorInput): {
    selected: QaScenario[];
    warnings: string[];
    uncoveredRequiredScenarios: string[];
    selectorMetadata: ScenarioMatch[];
  } {
    const selectorResult = this.selector.select({
      requiredScenarios: input.requiredScenarios!,
      scenarioChunks: input.scenarioChunks!,
    });

    const warnings = [...selectorResult.warnings];
    const selected = [...selectorResult.selectedScenarios];
    const matchedRequiredIds = new Set(selectorResult.metadata.map((m) => m.requiredId));
    const uncoveredRequiredScenarios: string[] = [];

    for (const required of input.requiredScenarios!) {
      if (!matchedRequiredIds.has(required.id)) {
        uncoveredRequiredScenarios.push(required.id);
      }
    }

    return { selected, warnings, uncoveredRequiredScenarios, selectorMetadata: selectorResult.metadata };
  }

  private async handleGenerationPhase(
    input: ScenarioOrchestratorInput,
    uncoveredIds: string[],
    warnings: string[],
  ): Promise<QaScenario[]> {
    if (uncoveredIds.length === 0) return [];

    warnings.push(
      `Uncovered required scenarios: ${uncoveredIds.join(', ')}. Generating via generator.`,
    );
    const uncovered = input.requiredScenarios!.filter((r) => uncoveredIds.includes(r.id));
    const generatorResult = await this.generator.generate({
      uncoveredRequiredScenarios: uncovered,
      config: input.config,
    });
    warnings.push(...generatorResult.warnings);
    return generatorResult.generated;
  }

  private buildResult(
    limited: QaScenario[],
    selected: QaScenario[],
    generated: QaScenario[],
    uncoveredRequiredScenarios: string[],
    warnings: string[],
  ): ScenarioOrchestratorResult {
    return { scenarios: limited, selected, generated, uncoveredRequiredScenarios, warnings };
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
