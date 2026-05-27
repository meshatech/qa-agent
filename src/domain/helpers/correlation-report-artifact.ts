import type { CorrelationResult } from '../schemas/correlation.schema.js';
import { CorrelationResultSchema } from '../schemas/correlation.schema.js';
import {
  renderCorrelationReport,
  type CorrelationReportContext,
} from './correlation-report.renderer.js';

export function prepareCorrelationReportArtifact(
  result: CorrelationResult,
  context?: CorrelationReportContext,
): string {
  const validated = CorrelationResultSchema.parse(result);
  return renderCorrelationReport(validated, context);
}
