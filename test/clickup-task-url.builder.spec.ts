import { describe, expect, it } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import {
  buildClickUpTaskUrl,
  CLICKUP_TASK_URL,
  isCustomClickUpTaskId,
} from '../src/infra/clickup/clickup-task-url.builder.js';

describe('isCustomClickUpTaskId', () => {
  it('returns true for workspace custom IDs', () => {
    expect(isCustomClickUpTaskId('PRJ-11366')).toBe(true);
  });

  it('returns false for internal ClickUp task IDs', () => {
    expect(isCustomClickUpTaskId('86ahmghew')).toBe(false);
  });
});

describe('buildClickUpTaskUrl', () => {
  it('builds URL with custom_task_ids and team_id for custom IDs', () => {
    expect(buildClickUpTaskUrl('PRJ-11366', { teamId: '459806' })).toBe(
      `${CLICKUP_TASK_URL}/PRJ-11366?custom_task_ids=true&team_id=459806`,
    );
  });

  it('builds URL without query params for internal IDs', () => {
    expect(buildClickUpTaskUrl('86ahmghew')).toBe(`${CLICKUP_TASK_URL}/86ahmghew`);
  });

  it('throws when custom ID is used without teamId', () => {
    expect(() => buildClickUpTaskUrl('PRJ-11366')).toThrow(ClickUpReaderError);
    expect(() => buildClickUpTaskUrl('PRJ-11366')).toThrow(
      /CLICKUP_TEAM_ID is required when using a custom ClickUp task ID/,
    );
    expect(() => buildClickUpTaskUrl('PRJ-1', {})).toThrow(ClickUpReaderError);
    expect(() => buildClickUpTaskUrl('PRJ-1', { teamId: '   ' })).toThrow(ClickUpReaderError);
  });
});
