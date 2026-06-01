import { Logger } from '@nestjs/common';

import { ClickUpReaderError } from '../../domain/errors.js';

const logger = new Logger('ClickUpTaskIdResolver');
const CLICKUP_TASK_ID_ENV = 'CLICKUP_TASK_ID';
const CLICKUP_TASK_ID_ENV_DEPRECATION_WARNING =
  'CLICKUP_TASK_ID env is deprecated; use config.clickup.taskId instead.';

export interface ResolvedClickUpTaskId {
  taskId: string;
  source: 'config' | 'env';
  warning?: string;
}

export function resolveClickUpTaskId(options?: {
  env?: NodeJS.ProcessEnv;
  configTaskId?: string | undefined;
}): string {
  return resolveClickUpTaskIdReference(options).taskId;
}

export function resolveClickUpTaskIdReference(options?: {
  env?: NodeJS.ProcessEnv;
  configTaskId?: string | undefined;
}): ResolvedClickUpTaskId {
  // Config is the canonical source; deprecated CLICKUP_TASK_ID env is fallback only.
  const fromConfig = options?.configTaskId?.trim();
  if (fromConfig) {
    return { taskId: fromConfig, source: 'config' };
  }

  const fromEnv = (options?.env ?? process.env)[CLICKUP_TASK_ID_ENV]?.trim();
  if (fromEnv) {
    logger.warn(CLICKUP_TASK_ID_ENV_DEPRECATION_WARNING);
    return {
      taskId: fromEnv,
      source: 'env',
      warning: CLICKUP_TASK_ID_ENV_DEPRECATION_WARNING,
    };
  }

  throw new ClickUpReaderError(
    'config.clickup.taskId is missing or empty and CLICKUP_TASK_ID env is not set',
  );
}
