import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { ScenarioCatalogItem } from '../../domain/models/scenario-catalog-item.model.js';
import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import {
  MemoryScenarioSelector,
  type ScenarioMatch,
} from './scenario-selectors/memory-scenario-selector.service.js';
import { RouteScenarioSelector } from './scenario-selectors/route-scenario-selector.service.js';
import { ComponentScenarioSelector } from './scenario-selectors/component-scenario-selector.service.js';
import {
  CriteriaScenarioSelector,
  type CriteriaSelectionResult,
} from './scenario-selectors/criteria-scenario-selector.service.js';

export type { CriteriaSelectionResult, ScenarioMatch };

export interface ScenarioSelectorInput {
  requiredScenarios: RequiredScenario[];
  scenarioChunks: MemoryChunk[];
}

export interface ScenarioSelectorResult {
  selectedScenarios: QaScenario[];
  warnings: string[];
  metadata: ScenarioMatch[];
}

@Injectable()
export class ScenarioSelectorService {
  constructor(
    @Inject(MemoryScenarioSelector) private readonly memorySelector: MemoryScenarioSelector,
    @Inject(RouteScenarioSelector) private readonly routeSelector: RouteScenarioSelector,
    @Inject(ComponentScenarioSelector) private readonly componentSelector: ComponentScenarioSelector,
    @Inject(CriteriaScenarioSelector) private readonly criteriaSelector: CriteriaScenarioSelector,
  ) {}

  async findCatalogItems(input: {
    requiredScenarios: RequiredScenario[];
    limitPerRequiredScenario?: number;
  }): Promise<ScenarioCatalogItem[]> {
    return this.memorySelector.findCatalogItems(input);
  }

  selectByRoute(input: {
    affectedRoutes: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    return this.routeSelector.selectByRoute(input);
  }

  selectByComponent(input: {
    affectedComponents: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    return this.componentSelector.selectByComponent(input);
  }

  selectByCriteria(input: {
    acceptanceCriteria: string[];
    catalogItems: ScenarioCatalogItem[];
  }): CriteriaSelectionResult {
    return this.criteriaSelector.selectByCriteria(input);
  }

  select(input: ScenarioSelectorInput): ScenarioSelectorResult {
    return this.memorySelector.select(input);
  }
}
