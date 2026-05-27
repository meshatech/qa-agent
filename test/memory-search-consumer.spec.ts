import { describe, expect, it } from 'vitest';

import { consumeMemorySearchResults } from '../src/domain/helpers/memory-search-consumer.js';
import type { MemorySearchResult } from '../src/domain/schemas/memory.schema.js';

const ROUTE_CHUNK: MemorySearchResult = {
  chunk: {
    id: 'route-login',
    type: 'route',
    title: 'Login route',
    content: 'Route /login validates user credentials',
    sourceFile: '.agent-qa/memory.md',
  },
  relevanceScore: 0.8,
};

const PROJECT_CHUNK: MemorySearchResult = {
  chunk: {
    id: 'project-qa',
    type: 'project',
    title: 'Agent QA',
    content: 'LLM-guided QA runtime',
    sourceFile: '.agent-qa/memory.md',
  },
  relevanceScore: 0.5,
};

describe('consumeMemorySearchResults', () => {
  it('extracts correlation chunks for route, flow and scenario types only', () => {
    const result = consumeMemorySearchResults([ROUTE_CHUNK, PROJECT_CHUNK]);

    expect(result.results).toEqual([ROUTE_CHUNK, PROJECT_CHUNK]);
    expect(result.correlationChunks).toEqual([ROUTE_CHUNK]);
    expect(result.isEmpty).toBe(false);
  });

  it('returns empty context without throwing when memory is empty', () => {
    const result = consumeMemorySearchResults([]);

    expect(result.results).toEqual([]);
    expect(result.correlationChunks).toEqual([]);
    expect(result.isEmpty).toBe(true);
  });

  it('throws when a memory search result is invalid', () => {
    expect(() =>
      consumeMemorySearchResults([
        {
          ...ROUTE_CHUNK,
          chunk: { ...ROUTE_CHUNK.chunk, id: '' },
        },
      ]),
    ).toThrow();
  });
});
