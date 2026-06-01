import type { PlanExecutionResult, LocatorTelemetryEvent } from '../services/plan-executor.service.js';

export interface PipelineExecuteRunResult {
  ok: boolean;
  executionResultPath?: string;
  stepsExecuted: number;
  stepsPassed: number;
  stepsFailed: number;
  warningsCount: number;
  locatorTelemetry: LocatorTelemetryEvent[];
  telemetrySummary: {
    deterministicResolutions: number;
    semanticFallbacks: number;
    llmDecides: number;
    replans: number;
    targetsNotFound: number;
  };
  failedMessage?: string;
}
