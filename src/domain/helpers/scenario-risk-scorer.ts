import type { CorrelationItem } from '../schemas/correlation.schema.js';
import type { RiskItem } from '../schemas/correlation.schema.js';

const REGRESSION_FILE_RISK = 0.25;

export interface ScenarioRiskScoreInput {
  correlation: CorrelationItem;
  relatedFiles: string[];
  risks: RiskItem[];
}

export function computeScenarioRiskScore(input: ScenarioRiskScoreInput): number {
  const base = 1 - Math.min(1, input.correlation.score);
  const fileRisk = input.relatedFiles.some((file) =>
    input.risks.some((risk) => risk.relatedFile === file && risk.type === 'regression'),
  )
    ? REGRESSION_FILE_RISK
    : 0;
  return Math.min(1, Math.max(0, base + fileRisk));
}
