import { describe, expect, it } from 'vitest';

import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import type { MemoryChunk } from '../src/domain/schemas/memory.schema.js';

const chunks: MemoryChunk[] = [
  {
    id: 'ROUTE-TEST-LOGIN-001',
    type: 'route',
    title: 'Login page',
    content: 'URL /login for authentication form',
    sourceFile: 'fixture',
  },
  {
    id: 'ROUTE-TEST-DASHBOARD-001',
    type: 'route',
    title: 'Dashboard page',
    content: 'URL /dashboard after login',
    sourceFile: 'fixture',
  },
  {
    id: 'LOC-TEST-LOGIN-001',
    type: 'semantic_locator',
    title: 'Login form locators',
    content: 'Email field and password field on login form',
    sourceFile: 'fixture',
  },
];

describe('BM25MemoryIndex', () => {
  it('ranks login-related chunks above unrelated content and respects limit', () => {
    const index = new BM25MemoryIndex();
    index.build(chunks);

    const results = index.search('login route', 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.chunk.id).toBe('ROUTE-TEST-LOGIN-001');
    expect(results[0]!.relevanceScore).toBeGreaterThan(results[1]!.relevanceScore);
  });

  it('returns an empty result for an empty index', () => {
    const index = new BM25MemoryIndex();
    index.build([]);

    expect(index.search('login', 5)).toEqual([]);
  });
});
