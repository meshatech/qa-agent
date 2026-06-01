export interface PipelinePromoteLearningRunResult {
  promotedPath: string;
  promotedCount: number;
  rejectedCount: number;
  promotionLogPath: string;
  warnings: string[];
}
