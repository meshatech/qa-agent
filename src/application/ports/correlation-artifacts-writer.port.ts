import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';

export interface CorrelationArtifactsWriteResult {
  requiredScenariosPath: string;
  correlationReportPath: string;
}

export interface CorrelationArtifactsWriterPort {
  write(
    outputDir: string,
    result: CorrelationResult,
    reportMarkdown: string,
  ): Promise<CorrelationArtifactsWriteResult>;
}
