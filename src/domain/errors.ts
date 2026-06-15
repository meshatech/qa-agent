import type { CorrelationResult } from './schemas/correlation.schema.js';
import type { PreflightReport } from './schemas/preflight-report.schema.js';

export class ConfigError extends Error {
  readonly name = 'ConfigError';
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export class HarnessFatalError extends Error {
  readonly name = 'HarnessFatalError';
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export class RunTimeoutError extends Error {
  readonly name = 'RunTimeoutError';
  constructor(message: string, public readonly elapsedMs: number) {
    super(message);
  }
}

export class PreflightBlockedError extends Error {
  readonly name = 'PreflightBlockedError';
  constructor(
    public readonly report: PreflightReport,
    public readonly reportPath?: string,
  ) {
    super('Pipeline preflight blocked');
  }
}

export class CorrelationBlockedError extends Error {
  readonly name = 'CorrelationBlockedError';
  constructor(
    public readonly result: CorrelationResult,
    public readonly requiredScenariosPath?: string,
    public readonly correlationReportPath?: string,
  ) {
    super(result.blockReason ?? 'Pipeline correlation blocked');
  }
}

export type ClickUpReaderErrorCode =
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'TASK_NOT_FOUND'
  | 'RATE_LIMIT_EXCEEDED'
  | 'API_ERROR'
  | 'REQUEST_FAILED';

export class ClickUpReaderError extends Error {
  readonly name = 'ClickUpReaderError';
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
    public readonly code?: ClickUpReaderErrorCode,
  ) {
    super(message);
  }
}

export type PrContextReaderErrorCode =
  | 'MISSING_CONTEXT'
  | 'INVALID_EVENT'
  | 'CLICKUP_TASK_ID_NOT_FOUND'
  | 'BASE_BRANCH_UNAVAILABLE'
  | 'GIT_DIFF_FAILED'
  | 'VALIDATION_FAILED';

export class PrContextReaderError extends Error {
  readonly name = 'PrContextReaderError';
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: PrContextReaderErrorCode,
  ) {
    super(message);
  }
}

export class ExecutionPlanBuildError extends Error {
  readonly name = 'ExecutionPlanBuildError';
  constructor(message: string) {
    super(message);
  }
}

export class GitHubCommentError extends Error {
  readonly name = 'GitHubCommentError';
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class LlmProviderError extends Error {
  readonly name = 'LlmProviderError';
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}
