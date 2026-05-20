import { ConfigError, HarnessFatalError, RunTimeoutError } from '../../domain/errors.js';
import type { QaRunResult } from '../../domain/models/run.model.js';

export const ExitCodes = {
  OK: 0,
  BUGS_FOUND: 1,
  CONFIG_ERROR: 2,
  HARNESS_FATAL: 3,
  TIMEOUT: 4,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

export function classifyError(err: unknown): ExitCode {
  if (err instanceof ConfigError) return ExitCodes.CONFIG_ERROR;
  if (err instanceof RunTimeoutError) return ExitCodes.TIMEOUT;
  if (err instanceof HarnessFatalError) return ExitCodes.HARNESS_FATAL;
  return ExitCodes.HARNESS_FATAL;
}

export function classifyResult(result: QaRunResult): ExitCode {
  const bugs = result.bugs ?? [];
  const hasHigh = bugs.some((b) => b.classification.severity === 'HIGH' || b.classification.severity === 'CRITICAL');
  if (hasHigh) return ExitCodes.BUGS_FOUND;
  if (result.status === 'BLOCKED' || result.status === 'FAILED') return ExitCodes.BUGS_FOUND;
  return ExitCodes.OK;
}
