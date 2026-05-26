import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';

export interface PreflightReportWriterPort {
  write(outputDir: string, report: PreflightReport): Promise<string>;
}
