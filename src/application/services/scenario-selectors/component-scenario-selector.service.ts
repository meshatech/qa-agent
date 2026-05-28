import { Injectable } from '@nestjs/common';

import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import { normalizeComponentName, componentMatches } from '../../../domain/helpers/component-matcher.js';

@Injectable()
export class ComponentScenarioSelector {
  selectByComponent(input: {
    affectedComponents: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    if (!input.affectedComponents.length) return [];

    const normalizedAffected = input.affectedComponents
      .map(normalizeComponentName)
      .filter((c) => c.length > 0);

    if (!normalizedAffected.length) return [];

    const seen = new Set<string>();
    const result: ScenarioCatalogItem[] = [];

    for (const item of input.catalogItems) {
      if (!item.component) continue;

      const normalizedScenario = normalizeComponentName(item.component);
      if (!normalizedScenario) continue;

      const matched = normalizedAffected.some((affected) =>
        componentMatches(affected, normalizedScenario),
      );

      if (matched && !seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }

    return result;
  }
}
