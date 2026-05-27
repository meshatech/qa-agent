import { describe, expect, it } from 'vitest';

import { ClickUpReaderError } from '../src/domain/errors.js';
import { resolveClickUpTaskId } from '../src/infra/clickup/clickup-task-id.resolver.js';

describe('resolveClickUpTaskId', () => {
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

  it('throws ClickUpReaderError when config taskId is empty', () => {
    expect(() =>
      resolveClickUpTaskId({
        configTaskId: '',
      }),
    ).toThrow(ClickUpReaderError);

    expect(() =>
      resolveClickUpTaskId({
        configTaskId: '   ',
      }),
    ).toThrow(/config\.clickup\.taskId is missing or empty/);

    expect(() => resolveClickUpTaskId()).toThrow(/config\.clickup\.taskId is missing or empty/);
  });
});
