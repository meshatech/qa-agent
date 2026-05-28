import { Injectable } from '@nestjs/common';

import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import { normalizeComponentName, componentMatches } from '../../../domain/helpers/component-matcher.js';
import { selectByProperty } from './select-by-property.helper.js';

@Injectable()
export class ComponentScenarioSelector {
  selectByComponent(input: {
    affectedComponents: string[];
    catalogItems: ScenarioCatalogItem[];
  }): ScenarioCatalogItem[] {
    return selectByProperty({
      affectedValues: input.affectedComponents,
      catalogItems: input.catalogItems,
      extractProperty: (item) => item.component,
      normalize: normalizeComponentName,
      matches: componentMatches,
    });
  }
}
