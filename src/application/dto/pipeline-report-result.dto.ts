export interface PipelineReportRunResult {
  reportPath: string;
  pipelineStatus: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  sectionsGenerated: string[];
}
