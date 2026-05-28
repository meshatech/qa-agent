import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ScenarioPlannerService } from './scenario-planner.service.js';
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
    @Inject(ScenarioPlannerService) private readonly planner: ScenarioPlannerService,
  ) {}

  async orchestrate(input: ScenarioOrchestratorInput): Promise<ScenarioOrchestratorResult> {
    const warnings: string[] = [];
    const selected: QaScenario[] = [];
    const generated: QaScenario[] = [];
    const uncoveredRequiredScenarios: string[] = [];

    const hasCatalog = input.requiredScenarios?.length && input.scenarioChunks?.length;

    if (!hasCatalog) {
      warnings.push('No required scenarios or catalog provided; falling back to full planner.');
      const planned = await this.planner.plan(input.config);
      return {
        scenarios: this.limitScenarios(planned),
        selected: [],
        generated: planned,
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
        `Uncovered required scenarios: ${uncoveredRequiredScenarios.join(', ')}. Generating via planner.`,
      );
      const tempConfig = this.buildConfigForUncovered(input.config, input.requiredScenarios!, uncoveredRequiredScenarios);
      const planned = await this.planner.plan(tempConfig);
      generated.push(...planned);
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

  private buildConfigForUncovered(
    baseConfig: RunConfig,
    allRequired: RequiredScenario[],
    uncoveredIds: string[],
  ): RunConfig {
    const uncovered = allRequired.filter((r) => uncoveredIds.includes(r.id));
    const criteria = uncovered.map((r) => `${r.title}: ${r.rationale}`);

    return {
      ...baseConfig,
      demand: {
        ...baseConfig.demand,
        title: `${baseConfig.demand.title} (uncovered)`,
        description: `Generated for uncovered requirements: ${uncoveredIds.join(', ')}`,
        acceptanceCriteria: criteria,
      },
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
