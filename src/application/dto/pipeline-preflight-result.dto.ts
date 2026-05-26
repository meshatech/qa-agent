import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';

export interface PipelinePreflightRunResult {
  report: PreflightReport;
  reportPath: string;
}
