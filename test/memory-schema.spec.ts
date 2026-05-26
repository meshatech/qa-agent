import { describe, expect, it } from 'vitest';

import {
  MemoryChunkSchema,
  MemoryChunkTypeSchema,
  MemorySearchResponseSchema,
} from '../src/domain/schemas/memory.schema.js';

describe('memory.schema', () => {
  it('accepts valid memory chunks for all supported types', () => {
    for (const type of MemoryChunkTypeSchema.options) {
      expect(MemoryChunkSchema.parse({
        id: `ID-${type.toUpperCase()}`,
        type,
        title: 'Sample',
        content: 'Sample content',
        sourceFile: '.agent-qa/memory.md',
      }).type).toBe(type);
    }
  });

  it('rejects unknown chunk types and missing required fields', () => {
    expect(() => MemoryChunkSchema.parse({
      id: 'ID-1',
      type: 'invalid',
      title: 'Sample',
      content: 'Sample content',
      sourceFile: '.agent-qa/memory.md',
    })).toThrow();

    expect(() => MemoryChunkSchema.parse({
      type: 'route',
      title: 'Sample',
      content: 'Sample content',
      sourceFile: '.agent-qa/memory.md',
    })).toThrow();
  });

  it('validates memory search responses', () => {
    const response = MemorySearchResponseSchema.parse({
      chunks: [{
        chunk: {
          id: 'ROUTE-TEST-LOGIN-001',
          type: 'route',
          title: 'Login page',
          content: 'login route',
          sourceFile: 'test/fixtures/agent-qa-memory.sample.md',
        },
        relevanceScore: 1.25,
      }],
      warnings: [],
    });

    expect(response.chunks).toHaveLength(1);
  });
});
