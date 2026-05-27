import { describe, expect, it } from 'vitest';

import {
  CorrelationItemSchema,
  createCorrelationItem,
} from '../src/domain/schemas/correlation-item.schema.js';

const VALID_CORRELATION_ITEM = {
  criterion: 'Login route validates user credentials',
  file: 'src/routes/login.ts',
  memoryChunk: 'ROUTE-TEST-LOGIN-001',
  score: 0.75,
  rationale: 'Criterion tokens overlap with changed file path src/routes/login.ts',
};

describe('CorrelationItemSchema', () => {
  it('accepts a valid correlation item with all fields', () => {
    expect(CorrelationItemSchema.parse(VALID_CORRELATION_ITEM)).toEqual(VALID_CORRELATION_ITEM);
  });

  it('accepts a valid correlation item without file and memoryChunk', () => {
    const { file: _file, memoryChunk: _memoryChunk, ...routeMatch } = VALID_CORRELATION_ITEM;
    expect(CorrelationItemSchema.parse(routeMatch)).toEqual(routeMatch);
  });

  it('rejects empty criterion', () => {
    expect(() => CorrelationItemSchema.parse({ ...VALID_CORRELATION_ITEM, criterion: '' })).toThrow();
  });

  it('rejects empty rationale', () => {
    expect(() => CorrelationItemSchema.parse({ ...VALID_CORRELATION_ITEM, rationale: '' })).toThrow();
  });

  it('rejects score below 0', () => {
    expect(() => CorrelationItemSchema.parse({ ...VALID_CORRELATION_ITEM, score: -0.1 })).toThrow();
  });

  it('rejects score above 1', () => {
    expect(() => CorrelationItemSchema.parse({ ...VALID_CORRELATION_ITEM, score: 1.1 })).toThrow();
  });

  it('rejects unknown fields under strict mode', () => {
    expect(() =>
      CorrelationItemSchema.parse({ ...VALID_CORRELATION_ITEM, extra: 'field' }),
    ).toThrow();
  });

  it('createCorrelationItem returns the same value as parse', () => {
    expect(createCorrelationItem(VALID_CORRELATION_ITEM)).toEqual(
      CorrelationItemSchema.parse(VALID_CORRELATION_ITEM),
    );
  });
});
