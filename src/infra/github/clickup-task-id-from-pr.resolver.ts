import { isCustomClickUpTaskId } from '../clickup/clickup-task-url.builder.js';

const CLICKUP_CUSTOM_ID_IN_TEXT_PATTERN = /PRJ-\d+/g;

function findFirstValidClickUpTaskId(text: string): string | undefined {
  const matches = text.match(CLICKUP_CUSTOM_ID_IN_TEXT_PATTERN);
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
): string | undefined {
  const fromTitle = findFirstValidClickUpTaskId(title);
  if (fromTitle) {
    return fromTitle;
  }

  const normalizedBody = body?.trim();
  if (!normalizedBody) {
    return undefined;
  }

  return findFirstValidClickUpTaskId(normalizedBody);
}
