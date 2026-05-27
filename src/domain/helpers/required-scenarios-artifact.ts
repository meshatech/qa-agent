import type { CorrelationResult } from '../schemas/correlation.schema.js';
import { CorrelationResultSchema } from '../schemas/correlation.schema.js';

export function prepareRequiredScenariosArtifact(result: CorrelationResult): string {
  const validated = CorrelationResultSchema.parse(result);
  return JSON.stringify(validated, null, 2);
}
