import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import { resolveClickUpTaskId } from '../src/infra/clickup/clickup-task-id.resolver.js';

describe('resolveClickUpTaskId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns config taskId when set', () => {
    expect(
      resolveClickUpTaskId({
        configTaskId: 'PRJ-11366',
      }),
    ).toBe('PRJ-11366');
  });

  it('trims whitespace from config taskId', () => {
    expect(
      resolveClickUpTaskId({
        configTaskId: '  PRJ-11366  ',
      }),
    ).toBe('PRJ-11366');
  });

  it('prefers config over deprecated CLICKUP_TASK_ID env', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: 'PRJ-from-env' },
        configTaskId: 'PRJ-from-config',
      }),
    ).toBe('PRJ-from-config');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to CLICKUP_TASK_ID env with deprecation warning', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    expect(
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: 'PRJ-11366' },
      }),
    ).toBe('PRJ-11366');

    expect(warnSpy).toHaveBeenCalledWith(
      'CLICKUP_TASK_ID env is deprecated; use config.clickup.taskId instead.',
    );
  });

  it('throws ClickUpReaderError when config and env are empty', () => {
    expect(() =>
      resolveClickUpTaskId({
        env: {},
        configTaskId: '',
      }),
    ).toThrow(ClickUpReaderError);

    expect(() =>
      resolveClickUpTaskId({
        env: { CLICKUP_TASK_ID: '   ' },
      }),
    ).toThrow(/config\.clickup\.taskId is missing or empty and CLICKUP_TASK_ID env is not set/);
  });
});
