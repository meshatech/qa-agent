import { Logger } from '@nestjs/common';

import { isCustomClickUpTaskId } from '../clickup/clickup-task-url.builder.js';

const logger = new Logger('ClickUpCustomIdPattern');

export const DEFAULT_CLICKUP_CUSTOM_ID_PATTERN = /PRJ-\d+/g;

const CLICKUP_CUSTOM_ID_PATTERN_ENV = 'CLICKUP_CUSTOM_ID_PATTERN';

export type ClickUpCustomIdPatternResult = {
  pattern: RegExp;
  usedFallback: boolean;
  invalidSource?: string;
};

export function compileClickUpCustomIdPattern(source?: string): ClickUpCustomIdPatternResult {
  if (!source?.trim()) {
    return {
      pattern: new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g'),
      usedFallback: false,
    };
  }

  try {
    return {
      pattern: new RegExp(source.trim(), 'g'),
      usedFallback: false,
    };
  } catch (error) {
    logger.warn(
      'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
      error instanceof Error ? error.stack : String(error),
    );
    return {
      pattern: new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g'),
      usedFallback: true,
      invalidSource: source.trim(),
    };
  }
}

export function resolveClickUpCustomIdPattern(options?: {
  env?: NodeJS.ProcessEnv;
  configPattern?: string;
}): ClickUpCustomIdPatternResult {
  const env = options?.env ?? process.env;
  const fromEnv = env[CLICKUP_CUSTOM_ID_PATTERN_ENV]?.trim();
  if (fromEnv) {
    return compileClickUpCustomIdPattern(fromEnv);
  }

  if (options?.configPattern?.trim()) {
    return compileClickUpCustomIdPattern(options.configPattern);
  }

  return compileClickUpCustomIdPattern();
}

function findFirstValidClickUpTaskId(text: string, pattern: RegExp): string | undefined {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const matches = text.match(globalPattern);
  if (!matches) {
    return undefined;
  }

  for (const candidate of matches) {
    if (isCustomClickUpTaskId(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function extractClickUpTaskIdFromPullRequestText(
  title: string,
  body?: string,
  pattern: RegExp = resolveClickUpCustomIdPattern().pattern,
): string | undefined {
  const fromTitle = findFirstValidClickUpTaskId(title, pattern);
  if (fromTitle) {
    return fromTitle;
  }

  const normalizedBody = body?.trim();
  if (!normalizedBody) {
    return undefined;
  }

  return findFirstValidClickUpTaskId(normalizedBody, pattern);
}
