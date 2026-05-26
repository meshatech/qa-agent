import { describe, expect, it } from 'vitest';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';

const VALID_DEMAND_CONTEXT = {
  taskId: 'PRJ-11361',
  title: 'Criar DemandContext',
  description: 'Criar o contrato de domínio DemandContext para representar a demanda extraída de uma task do ClickUp.',
  acceptanceCriteria: ['DemandContext é definido no domínio'],
  attachments: [
    {
      name: 'spec.pdf',
      url: 'https://example.com/spec.pdf',
      type: 'application/pdf',
    },
  ],
  status: 'fazendo',
  assignees: ['Joao de tal da silva'],
  priority: null,
  dueDate: null,
};

describe('DemandContextSchema', () => {
  it('accepts a valid demand context with all fields', () => {
    expect(DemandContextSchema.parse(VALID_DEMAND_CONTEXT)).toEqual(VALID_DEMAND_CONTEXT);
  });

  it('defaults acceptanceCriteria and attachments to empty arrays when omitted', () => {
    const { acceptanceCriteria: _ac, attachments: _at, ...withoutArrays } = VALID_DEMAND_CONTEXT;
    expect(DemandContextSchema.parse(withoutArrays)).toEqual({
      ...withoutArrays,
      acceptanceCriteria: [],
      attachments: [],
    });
  });

  it('defaults assignees to empty array when omitted', () => {
    const { assignees: _assignees, ...withoutAssignees } = VALID_DEMAND_CONTEXT;
    expect(DemandContextSchema.parse(withoutAssignees).assignees).toEqual([]);
  });

  it('accepts priority and dueDate as null', () => {
    expect(
      DemandContextSchema.parse({
        ...VALID_DEMAND_CONTEXT,
        priority: null,
        dueDate: null,
      }).priority,
    ).toBeNull();
    expect(
      DemandContextSchema.parse({
        ...VALID_DEMAND_CONTEXT,
        dueDate: '2026-05-26T12:00:00.000Z',
        priority: 'high',
      }).dueDate,
    ).toBe('2026-05-26T12:00:00.000Z');
  });

  it('rejects empty taskId', () => {
    expect(() => DemandContextSchema.parse({ ...VALID_DEMAND_CONTEXT, taskId: '' })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => DemandContextSchema.parse({ ...VALID_DEMAND_CONTEXT, title: '' })).toThrow();
  });

  it('rejects attachment with invalid url', () => {
    expect(() =>
      DemandContextSchema.parse({
        ...VALID_DEMAND_CONTEXT,
        attachments: [{ name: 'bad.pdf', url: 'not-a-url', type: 'application/pdf' }],
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      DemandContextSchema.parse({
        ...VALID_DEMAND_CONTEXT,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
