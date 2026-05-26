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
