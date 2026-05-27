import { describe, expect, it } from 'vitest';

import { consumeDemandContext } from '../src/domain/helpers/demand-context-consumer.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11396',
  title: 'Consumir DemandContext',
  description: 'Extract acceptance criteria for correlation.',
  acceptanceCriteria: [
    'Login route validates user credentials',
    'Invalid login shows error message',
  ],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

describe('consumeDemandContext', () => {
  it('extracts acceptance criteria from a valid demand context', () => {
    expect(consumeDemandContext(BASE_DEMAND)).toEqual({
      taskId: 'PRJ-11396',
      title: 'Consumir DemandContext',
      acceptanceCriteria: [
        'Login route validates user credentials',
        'Invalid login shows error message',
      ],
    });
  });

  it('trims whitespace from criteria', () => {
    const result = consumeDemandContext({
      ...BASE_DEMAND,
      acceptanceCriteria: ['  Login route validates user credentials  '],
    });

    expect(result.acceptanceCriteria).toEqual(['Login route validates user credentials']);
  });

  it('deduplicates criteria while preserving order', () => {
    const result = consumeDemandContext({
      ...BASE_DEMAND,
      acceptanceCriteria: [
        'Login route validates user credentials',
        'Invalid login shows error message',
        'Login route validates user credentials',
      ],
    });

    expect(result.acceptanceCriteria).toEqual([
      'Login route validates user credentials',
      'Invalid login shows error message',
    ]);
  });

  it('returns an empty criteria array when demand has none', () => {
    expect(consumeDemandContext({ ...BASE_DEMAND, acceptanceCriteria: [] }).acceptanceCriteria).toEqual(
      [],
    );
  });

  it('throws when demand context is invalid', () => {
    expect(() => consumeDemandContext({ ...BASE_DEMAND, taskId: '' })).toThrow();
  });
});
