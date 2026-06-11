import { ConfigError, HarnessFatalError, PreflightBlockedError, CorrelationBlockedError, RunTimeoutError } from '../../domain/errors.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';

import type { OnboardingResult } from '../../domain/models/readiness.model.js';

export const ExitCodes = {
  OK: 0,
  BUGS_FOUND: 1,
  CONFIG_ERROR: 2,
  HARNESS_FATAL: 3,
  TIMEOUT: 4,
  ONBOARDING_BLOCKED: 5,
  PREFLIGHT_BLOCKED: 6,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

export function classifyError(err: unknown): ExitCode {
  if (err instanceof ConfigError) return ExitCodes.CONFIG_ERROR;
  if (err instanceof PreflightBlockedError) return ExitCodes.PREFLIGHT_BLOCKED;
  if (err instanceof CorrelationBlockedError) return ExitCodes.PREFLIGHT_BLOCKED;
  if (err instanceof RunTimeoutError) return ExitCodes.TIMEOUT;
  if (err instanceof HarnessFatalError) return ExitCodes.HARNESS_FATAL;
  return ExitCodes.HARNESS_FATAL;
}

export function classifyPreflightReport(report: PreflightReport): ExitCode {
  if (report.status === 'BLOCKED') return ExitCodes.PREFLIGHT_BLOCKED;
  return ExitCodes.OK;
}

export function classifyCorrelationResult(result: CorrelationResult): ExitCode {
  if (result.status === 'BLOCKED') return ExitCodes.PREFLIGHT_BLOCKED;
  return ExitCodes.OK;
}

export function classifyResult(result: QaRunResult): ExitCode {
  const bugs = result.bugs ?? [];
  const hasHigh = bugs.some((b) => b.classification.severity === 'HIGH' || b.classification.severity === 'CRITICAL');
  if (hasHigh) return ExitCodes.BUGS_FOUND;
  if (result.status === 'BLOCKED' || result.status === 'FAILED') return ExitCodes.BUGS_FOUND;
  return ExitCodes.OK;
}

export function classifyOnboardingResult(result: OnboardingResult): ExitCode {
  if (result.readiness === 'READY') return ExitCodes.OK;
  if (result.readiness === 'ONBOARDING_BLOCKED') return ExitCodes.ONBOARDING_BLOCKED;
  return ExitCodes.OK;
}

const SEVERITY_RANK: Record<ExitCode, number> = {
  [ExitCodes.OK]: 0,
  [ExitCodes.CONFIG_ERROR]: 1,
  [ExitCodes.BUGS_FOUND]: 2,
  [ExitCodes.PREFLIGHT_BLOCKED]: 3,
  [ExitCodes.ONBOARDING_BLOCKED]: 4,
  [ExitCodes.TIMEOUT]: 4,
  [ExitCodes.HARNESS_FATAL]: 5,
};

export function mostSevereExitCode(codes: ExitCode[]): ExitCode {
  if (codes.length === 0) return ExitCodes.OK;
  return codes.reduce((worst, code) =>
    SEVERITY_RANK[code] > SEVERITY_RANK[worst] ? code : worst,
  );
}
