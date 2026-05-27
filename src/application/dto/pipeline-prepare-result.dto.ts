import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export interface PipelinePrepareRunResult {
  preflightReport: PreflightReport;
  preflightReportPath: string;
  prDiffContext: PrDiffContext;
  prDiffContextPath: string;
  tokensMasked: boolean;
}
