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
