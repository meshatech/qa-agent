import { isCustomClickUpTaskId } from '../clickup/clickup-task-url.builder.js';

export const DEFAULT_CLICKUP_CUSTOM_ID_PATTERN = /PRJ-\d+/g;

const CLICKUP_CUSTOM_ID_PATTERN_ENV = 'CLICKUP_CUSTOM_ID_PATTERN';

export function compileClickUpCustomIdPattern(source?: string): RegExp {
  if (!source?.trim()) {
    return new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g');
  }

  try {
    return new RegExp(source.trim(), 'g');
  } catch {
    return new RegExp(DEFAULT_CLICKUP_CUSTOM_ID_PATTERN.source, 'g');
  }
}

export function resolveClickUpCustomIdPattern(options?: {
  env?: NodeJS.ProcessEnv;
  configPattern?: string;
}): RegExp {
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
  pattern: RegExp = resolveClickUpCustomIdPattern(),
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
