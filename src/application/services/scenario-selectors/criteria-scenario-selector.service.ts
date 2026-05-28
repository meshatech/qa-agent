import { Injectable } from '@nestjs/common';

import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import { computeOverlapScore } from '../../../domain/helpers/lexical-overlap.js';

const MIN_CRITERIA_MATCH_SCORE = 0.45;

export interface CriteriaSelectionResult {
  selectedItems: ScenarioCatalogItem[];
  coverageMetadata: Array<{
    acceptanceCriterion: string;
    matchedScenarioId: string;
    score: number;
    matchedCriterion?: string;
  }>;
  uncoveredCriteria: string[];
  warnings: string[];
}

@Injectable()
export class CriteriaScenarioSelector {
  selectByCriteria(input: {
    acceptanceCriteria: string[];
    catalogItems: ScenarioCatalogItem[];
  }): CriteriaSelectionResult {
    const coverageMetadata: CriteriaSelectionResult['coverageMetadata'] = [];
    const uncoveredCriteria: string[] = [];
    const warnings: string[] = [];

    if (!input.acceptanceCriteria.length) {
      warnings.push('No acceptance criteria provided; selection skipped.');
      return { selectedItems: [], coverageMetadata, uncoveredCriteria, warnings };
    }

    const criteria = input.acceptanceCriteria
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const matchedItemIds = new Set<string>();

    for (const acceptanceCriterion of criteria) {
      let bestMatch: { item: ScenarioCatalogItem; score: number; matchedCriterion: string } | undefined;

      for (const item of input.catalogItems) {
        if (!item.criteria?.length) continue;

        for (const itemCriterion of item.criteria) {
          const score = computeOverlapScore(acceptanceCriterion, itemCriterion);
          if (score >= MIN_CRITERIA_MATCH_SCORE) {
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { item, score, matchedCriterion: itemCriterion };
            }
          }
        }
      }

      if (bestMatch) {
        coverageMetadata.push({
          acceptanceCriterion,
          matchedScenarioId: bestMatch.item.id,
          score: bestMatch.score,
          matchedCriterion: bestMatch.matchedCriterion,
        });
        matchedItemIds.add(bestMatch.item.id);
      } else {
        uncoveredCriteria.push(acceptanceCriterion);
      }
    }

    const selectedItems = input.catalogItems.filter((item) => matchedItemIds.has(item.id));

    return { selectedItems, coverageMetadata, uncoveredCriteria, warnings };
  }
}
