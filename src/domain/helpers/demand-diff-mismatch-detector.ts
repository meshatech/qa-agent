import { overlapScore, pathTokens, tokenize } from './correlation-lexical.js';
import type { ConsumedDemandContext } from './demand-context-consumer.js';
import type { ConsumedPrDiffContext } from './pr-diff-context-consumer.js';
import { createRiskItem } from '../schemas/risk-item.schema.js';
import type { RiskItem } from '../schemas/correlation.schema.js';

const MISMATCH_THRESHOLD = 0.15;
const MISMATCH_MIN_COVERAGE_RATIO = 0.5;

export interface DemandDiffMismatchInput {
  demand: ConsumedDemandContext;
  prDiff: ConsumedPrDiffContext;
}

export function detectDemandDiffMismatch(input: DemandDiffMismatchInput): RiskItem[] {
  const diffTokens = buildDiffTokens(input.prDiff);

  if (!diffTokens.size || !input.demand.acceptanceCriteria.length) {
    return [];
  }

  const coveredCount = input.demand.acceptanceCriteria.filter((criterion) => {
    const criterionTokens = tokenize(criterion);
    return criterionTokens.size && overlapScore(criterionTokens, diffTokens) >= MISMATCH_THRESHOLD;
  }).length;

  if (coveredCount / input.demand.acceptanceCriteria.length >= MISMATCH_MIN_COVERAGE_RATIO) {
    return [];
  }

  const demandTokens = tokenize(
    [input.demand.title, input.demand.description, ...input.demand.acceptanceCriteria].join(' '),
  );

  if (!demandTokens.size) {
    return [];
  }

  const score = overlapScore(demandTokens, diffTokens);

  return [
    createRiskItem({
      severity: 'MEDIUM',
      description: `Demand "${input.demand.title}" has low lexical overlap with PR diff (score ${score.toFixed(2)}, ${coveredCount}/${input.demand.acceptanceCriteria.length} criteria covered); PR may not cover the demand`,
      type: 'demand_diff_mismatch',
    }),
  ];
}

function buildDiffTokens(prDiff: ConsumedPrDiffContext): Set<string> {
  const tokens = new Set<string>();

  for (const file of prDiff.changedFiles) {
    for (const token of pathTokens(file.path)) {
      tokens.add(token);
    }
  }

  for (const route of prDiff.affectedRoutes) {
    for (const token of tokenize(route)) {
      tokens.add(token);
    }
  }

  for (const schema of prDiff.affectedSchemas) {
    for (const token of pathTokens(schema)) {
      tokens.add(token);
    }
  }

  for (const token of tokenize(prDiff.pullRequest.title)) {
    tokens.add(token);
  }

  return tokens;
}
