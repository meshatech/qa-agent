import { Logger } from '@nestjs/common';
import safeRegex from 'safe-regex';

import { isCustomClickUpTaskId } from '../clickup/clickup-task-url.builder.js';

const logger = new Logger('ClickUpCustomIdPattern');

export const DEFAULT_CLICKUP_CUSTOM_ID_PATTERN = /PRJ-\d+/g;

const CLICKUP_CUSTOM_ID_PATTERN_ENV = 'CLICKUP_CUSTOM_ID_PATTERN';
const MAX_PATTERN_SOURCE_LENGTH = 100;
const SAFE_PATTERN_CHARS = /^[\w\d\\\[\]\(\)\{\}\^\$\.\|\?\*\+\-]+$/;

export const INVALID_CUSTOM_ID_PATTERN_WARNING =
  'Invalid custom ID pattern; using default PRJ-\\d+';

export type ClickUpCustomIdPatternResult = {
  pattern: RegExp;
  usedFallback: boolean;
  invalidSource?: string;
  warning?: string;
};

function defaultPatternResult(): ClickUpCustomIdPatternResult {
  return {
    pattern: new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g'),
    usedFallback: false,
  };
}

function fallbackPatternResult(invalidSource: string, reason: string | Error): ClickUpCustomIdPatternResult {
  logger.warn(
    'Invalid CLICKUP_CUSTOM_ID_PATTERN, falling back to default PRJ-\\d+',
    reason instanceof Error ? reason.stack : reason,
  );
  return {
    pattern: new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g'),
    usedFallback: true,
    invalidSource,
    warning: INVALID_CUSTOM_ID_PATTERN_WARNING,
  };
}

export function validatePatternSource(source: string): string | undefined {
  const trimmed = source.trim();
  if (trimmed.length > MAX_PATTERN_SOURCE_LENGTH) {
    return 'pattern exceeds 100 characters';
  }
  if (!SAFE_PATTERN_CHARS.test(trimmed)) {
    return 'pattern contains disallowed characters';
  }
  if (!safeRegex(trimmed)) {
    return 'pattern is potentially unsafe (ReDoS)';
  }
  return undefined;
}

export function compileClickUpCustomIdPattern(source?: string): ClickUpCustomIdPatternResult {
  if (!source?.trim()) {
    return defaultPatternResult();
  }

  const trimmed = source.trim();
  const validationError = validatePatternSource(trimmed);
  if (validationError) {
    return fallbackPatternResult(trimmed, validationError);
  }

  try {
    return {
      pattern: new RegExp(trimmed, 'g'),
      usedFallback: false,
    };
  } catch (error) {
    return fallbackPatternResult(trimmed, error instanceof Error ? error : String(error));
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
