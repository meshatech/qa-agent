export interface PipelineRiskRunResult {
  riskScorePath: string;
  value: number;
  level: string;
  factorCount: number;
  explanation: string;
}
