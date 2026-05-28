import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ScenarioPlannerService } from './scenario-planner.service.js';

export interface ScenarioGeneratorInput {
  uncoveredRequiredScenarios: RequiredScenario[];
  config: RunConfig;
  context?: {
    affectedRoutes?: string[];
    affectedComponents?: string[];
    acceptanceCriteria?: string[];
    memoryRefs?: MemoryChunk[];
    selectedScenarioIds?: string[];
  };
}

export interface ScenarioGeneratorResult {
  generated: QaScenario[];
  warnings: string[];
}

@Injectable()
export class ScenarioGeneratorService {
  constructor(
    @Inject(ScenarioPlannerService)
    private readonly planner: ScenarioPlannerService,
  ) {}

  async generate(input: ScenarioGeneratorInput): Promise<ScenarioGeneratorResult> {
    const warnings: string[] = [];

    if (!input.uncoveredRequiredScenarios.length) {
      warnings.push('No uncovered required scenarios; generation skipped.');
      return { generated: [], warnings };
    }

    const generationConfig = this.buildConfigForGeneration(
      input.config,
      input.uncoveredRequiredScenarios,
      input.context,
    );

    const scenarios = await this.planner.plan(generationConfig);

    return { generated: scenarios, warnings };
  }

  private buildConfigForGeneration(
    baseConfig: RunConfig,
    uncovered: RequiredScenario[],
    context?: ScenarioGeneratorInput['context'],
  ): RunConfig {
    const descriptionParts: string[] = [];

    descriptionParts.push('## Uncovered Required Scenarios');
    for (const required of uncovered) {
      descriptionParts.push(`### ${required.id} — ${required.title}`);
      descriptionParts.push(`Reason: ${required.rationale}`);
    }

    if (context?.affectedRoutes?.length) {
      descriptionParts.push('## Affected Routes');
      for (const route of context.affectedRoutes) {
        descriptionParts.push(`- ${route}`);
      }
    }

    if (context?.affectedComponents?.length) {
      descriptionParts.push('## Affected Components');
      for (const component of context.affectedComponents) {
        descriptionParts.push(`- ${component}`);
      }
    }

    if (context?.memoryRefs?.length) {
      descriptionParts.push('## Memory References');
      for (const chunk of context.memoryRefs) {
        descriptionParts.push(`- ${chunk.type}:${chunk.id} — ${chunk.title}`);
      }
    }

    const criteriaSet = new Set<string>();
    for (const required of uncovered) {
      criteriaSet.add(`${required.title}: ${required.rationale}`);
    }
    if (context?.acceptanceCriteria?.length) {
      for (const criterion of context.acceptanceCriteria) {
        criteriaSet.add(criterion.trim());
      }
    }

    return {
      ...baseConfig,
      demand: {
        ...baseConfig.demand,
        title: `${baseConfig.demand.title} — Generated scenarios for uncovered QA requirements`,
        description: descriptionParts.join('\n\n'),
        acceptanceCriteria: [...criteriaSet].filter((c) => c.length > 0),
      },
    };
  }
}
