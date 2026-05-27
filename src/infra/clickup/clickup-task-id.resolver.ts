import { Logger } from '@nestjs/common';

import { ClickUpReaderError } from '../../domain/errors.js';

const logger = new Logger('ClickUpTaskIdResolver');
const CLICKUP_TASK_ID_ENV = 'CLICKUP_TASK_ID';

export function resolveClickUpTaskId(options?: {
  env?: NodeJS.ProcessEnv;
  configTaskId?: string | undefined;
}): string {
  const fromConfig = options?.configTaskId?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  const fromEnv = (options?.env ?? process.env)[CLICKUP_TASK_ID_ENV]?.trim();
  if (fromEnv) {
    logger.warn('CLICKUP_TASK_ID env is deprecated; use config.clickup.taskId instead.');
    return fromEnv;
  }

  throw new ClickUpReaderError(
    'config.clickup.taskId is missing or empty and CLICKUP_TASK_ID env is not set',
  );
}
