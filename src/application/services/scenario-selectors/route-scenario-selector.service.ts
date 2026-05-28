import { Injectable } from '@nestjs/common';

import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import { normalizeRoute, routeMatches } from '../../../domain/helpers/route-matcher.js';

@Injectable()
export class RouteScenarioSelector {
  selectByRoute(input: {
    affectedRoutes: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    if (!input.affectedRoutes.length) return [];

    const normalizedAffected = input.affectedRoutes
      .map(normalizeRoute)
      .filter((r) => r.length > 0);

    if (!normalizedAffected.length) return [];

    const seen = new Set<string>();
    const result: ScenarioCatalogItem[] = [];

    for (const item of input.catalogItems) {
      if (!item.route) continue;

      const normalizedScenario = normalizeRoute(item.route);
      if (!normalizedScenario) continue;

      const matched = normalizedAffected.some((affected) =>
        routeMatches(affected, normalizedScenario),
      );

      if (matched && !seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }

    return result;
  }
}
