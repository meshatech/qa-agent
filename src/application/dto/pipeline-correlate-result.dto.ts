import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';

export interface PipelineCorrelateRunResult {
  result: CorrelationResult;
  requiredScenariosPath: string;
  correlationReportPath: string;
  selectedScenariosPath?: string;
  demandContextPath: string;
  demand: DemandContext;
  memoryConsultationLogPath?: string;
}
