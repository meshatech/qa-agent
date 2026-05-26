import { describe, expect, it } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import { resolveClickUpTaskId } from '../src/infra/clickup/clickup-task-id.resolver.js';

describe('resolveClickUpTaskId', () => {
  it('returns CLICKUP_TASK_ID from environment', () => {
    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: 'PRJ-11366' },
      }),
    ).toBe('PRJ-11366');
  });

  it('trims whitespace from environment value', () => {
    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: '  PRJ-11366  ' },
      }),
    ).toBe('PRJ-11366');
  });

  it('falls back to config taskId when env is missing', () => {
    expect(
      resolveClickUpTaskId({
        env: {},
        configTaskId: 'PRJ-from-config',
      }),
    ).toBe('PRJ-from-config');
  });

  it('falls back to config when env is whitespace only', () => {
    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: '   ' },
        configTaskId: 'PRJ-from-config',
      }),
    ).toBe('PRJ-from-config');
  });

  it('prefers environment over config when both are set', () => {
    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: 'PRJ-from-env' },
        configTaskId: 'PRJ-from-config',
      }),
    ).toBe('PRJ-from-env');
  });

  it('throws ClickUpReaderError when env and config are empty', () => {
    expect(() =>
      resolveClickUpTaskId({
        env: {},
        configTaskId: '',
      }),
    ).toThrow(ClickUpReaderError);

    expect(() =>
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: '  ' },
      }),
    ).toThrow(/CLICKUP_TASK_ID is missing or empty/);
  });
});
