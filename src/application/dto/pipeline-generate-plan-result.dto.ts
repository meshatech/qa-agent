export interface PipelineGeneratePlanRunResult {
  executionPlanPath?: string;
  planSource?: string;
  fallbackReason?: string;
  fallbackWarning?: string;
  qualityAudit: {
    semanticTargetsPerTask: number;
    hasFragileTargets: boolean;
    hasGenericTargets: boolean;
    hasUnobservableTargets: boolean;
  };
  warnings: string[];
}
