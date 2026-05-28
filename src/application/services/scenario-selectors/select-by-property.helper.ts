import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';

export interface SelectByPropertyInput {
  affectedValues: string[];
  catalogItems: ScenarioCatalogItem[];
  extractProperty: (item: ScenarioCatalogItem) => string | undefined;
  normalize: (value: string) => string;
  matches: (affected: string, scenario: string) => boolean;
}

export function selectByProperty(input: SelectByPropertyInput): ScenarioCatalogItem[] {
  if (!input.affectedValues.length) return [];

  const normalizedAffected = input.affectedValues
    .map(input.normalize)
    .filter((v) => v.length > 0);

  if (!normalizedAffected.length) return [];

  const seen = new Set<string>();
  const result: ScenarioCatalogItem[] = [];

  for (const item of input.catalogItems) {
    const rawProperty = input.extractProperty(item);
    if (!rawProperty) continue;

    const normalizedScenario = input.normalize(rawProperty);
    if (!normalizedScenario) continue;

    const matched = normalizedAffected.some((affected) =>
      input.matches(affected, normalizedScenario),
    );

    if (matched && !seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }

  return result;
}
