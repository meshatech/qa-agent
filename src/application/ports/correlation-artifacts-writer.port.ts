import type { CorrelationReportContext } from '../../domain/helpers/correlation-report.renderer.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';

export interface CorrelationArtifactsWriteResult {
  requiredScenariosPath: string;
  correlationReportPath: string;
  selectedScenariosPath?: string;
}

export interface CorrelationArtifactsWriterPort {
  write(
    outputDir: string,
    result: CorrelationResult,
    selectedScenarios?: QaScenario[],
    context?: CorrelationReportContext,
  ): Promise<CorrelationArtifactsWriteResult>;
}
