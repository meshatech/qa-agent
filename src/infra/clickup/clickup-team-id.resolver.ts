import { ClickUpReaderError } from '../../domain/errors.js';

const CLICKUP_TEAM_ID_ENV = 'CLICKUP_TEAM_ID';

export function resolveClickUpTeamId(options?: {
  env?: NodeJS.ProcessEnv;
  configTeamId?: string | undefined;
  required?: boolean;
}): string | undefined {
  const env = options?.env ?? process.env;
  const fromEnv = env[CLICKUP_TEAM_ID_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromConfig = options?.configTeamId?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  if (options?.required) {
    throw new ClickUpReaderError('CLICKUP_TEAM_ID is missing or empty');
  }

  return undefined;
}
