import { ClickUpReaderError } from '../../domain/errors.js';

const CLICKUP_TASK_ID_ENV = 'CLICKUP_TASK_ID';

export function resolveClickUpTaskId(options?: {
  env?: NodeJS.ProcessEnv;
  configTaskId?: string | undefined;
}): string {
  const env = options?.env ?? process.env;
  const fromEnv = env[CLICKUP_TASK_ID_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromConfig = options?.configTaskId?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  throw new ClickUpReaderError('CLICKUP_TASK_ID is missing or empty');
}
