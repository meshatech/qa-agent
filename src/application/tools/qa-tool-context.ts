import type { RunConfig } from '../../domain/schemas/config.schema.js';

export interface QaToolContext {
  runId?: string;
  runDir?: string;
  scenarioId?: string;
  taskId?: string;
  config?: RunConfig;
  metadata?: Record<string, unknown>;
}
