import { ClickUpReaderError } from '../../domain/errors.js';

export const CLICKUP_TASK_URL = 'https://api.clickup.com/api/v2/task';

const CUSTOM_TASK_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

export function isCustomClickUpTaskId(taskId: string): boolean {
  return CUSTOM_TASK_ID_PATTERN.test(taskId.trim());
}

export function buildClickUpTaskUrl(
  taskId: string,
  options?: { teamId?: string | undefined },
): string {
  const normalizedTaskId = taskId.trim();
  const baseUrl = `${CLICKUP_TASK_URL}/${encodeURIComponent(normalizedTaskId)}`;

  if (!isCustomClickUpTaskId(normalizedTaskId)) {
    return baseUrl;
  }

  const teamId = options?.teamId?.trim();
  if (!teamId) {
    throw new ClickUpReaderError(
      'CLICKUP_TEAM_ID is required when using a custom ClickUp task ID',
    );
  }

  const params = new URLSearchParams({
    custom_task_ids: 'true',
    team_id: teamId,
  });

  return `${baseUrl}?${params.toString()}`;
}
