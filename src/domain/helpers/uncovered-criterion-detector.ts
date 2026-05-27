import { truncate } from './correlation-lexical.js';
import { createRiskItem } from '../schemas/risk-item.schema.js';
import type { CorrelationItem } from '../schemas/correlation.schema.js';
import type { RiskItem } from '../schemas/correlation.schema.js';

const DEFAULT_MIN_OVERLAP_SCORE = 0.15;

export interface UncoveredCriterionInput {
  acceptanceCriteria: string[];
  correlations: CorrelationItem[];
  minOverlapScore?: number;
}

export interface UncoveredCriterionResult {
  risks: RiskItem[];
  uncoveredCriteria: string[];
}

export function detectUncoveredCriteria(input: UncoveredCriterionInput): UncoveredCriterionResult {
  const minOverlapScore = input.minOverlapScore ?? DEFAULT_MIN_OVERLAP_SCORE;
  const risks: RiskItem[] = [];
  const uncoveredCriteria: string[] = [];

  for (const correlation of input.correlations) {
    if (correlation.score >= minOverlapScore) {
      continue;
    }

    uncoveredCriteria.push(correlation.criterion);
    risks.push(
      createRiskItem({
        severity: 'HIGH',
        description: `Acceptance criterion has no related changed file or route: "${truncate(correlation.criterion, 120)}"`,
        type: 'uncovered_criterion',
      }),
    );
  }

  return { risks, uncoveredCriteria };
}
