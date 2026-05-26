import { afterEach, describe, expect, it, vi } from 'vitest';

import * as reproductionStepsParser from '../src/infra/clickup/clickup-reproduction-steps.parser.js';
import { mapClickUpTaskToReadResult } from '../src/infra/clickup/clickup-task-response.mapper.js';

describe('mapClickUpTaskToReadResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns demand without bug when BugContext validation fails', () => {
    vi.spyOn(reproductionStepsParser, 'extractClickUpReproductionSteps').mockReturnValue(['']);

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11369',
      name: 'Optional bug context',
      description: 'Task body',
      status: { status: 'fazendo' },
    });

    expect(result.demand.taskId).toBe('PRJ-11369');
    expect(result.demand.title).toBe('Optional bug context');
    expect(result.bug).toBeUndefined();
  });
});
