import type { CorrelationReportContext } from '../../domain/helpers/correlation-report.renderer.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';

export interface CorrelationArtifactsWriteResult {
  requiredScenariosPath: string;
  correlationReportPath: string;
}

export interface CorrelationArtifactsWriterPort {
  write(
    outputDir: string,
    result: CorrelationResult,
    context?: CorrelationReportContext,
  ): Promise<CorrelationArtifactsWriteResult>;
}
