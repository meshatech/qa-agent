import { ClickUpReaderError } from '../../domain/errors.js';

export function resolveClickUpTaskId(options?: {
  configTaskId?: string | undefined;
}): string {
  const fromConfig = options?.configTaskId?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  throw new ClickUpReaderError('config.clickup.taskId is missing or empty');
}
