import { Injectable } from '@nestjs/common';

import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import { normalizeRoute, routeMatches } from '../../../domain/helpers/route-matcher.js';
import { selectByProperty } from './select-by-property.helper.js';

@Injectable()
export class RouteScenarioSelector {
  selectByRoute(input: {
    affectedRoutes: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    return selectByProperty({
      affectedValues: input.affectedRoutes,
      catalogItems: input.catalogItems,
      extractProperty: (item) => item.route,
      normalize: normalizeRoute,
      matches: routeMatches,
    });
  }
}
