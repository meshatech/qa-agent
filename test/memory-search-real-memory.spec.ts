import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';

describe('memory search against repo memory.md', () => {
  it('finds login, dashboard and form terms in .agent-qa/memory.md', async () => {
    const loader = new MemoryMarkdownLoader();
    const service = new MemorySearchService(new MemoryChunker(loader), new BM25MemoryIndex(), loader);
    const memoryPath = join(process.cwd(), '.agent-qa/memory.md');

    for (const query of ['login', 'dashboard', 'cadastro']) {
      const result = await service.search({ memoryPath, query, limit: 3 });
      expect(result.chunks.length).toBeGreaterThan(0);
    }
  });

  it('filters repo memory by route type', async () => {
    const loader = new MemoryMarkdownLoader();
    const service = new MemorySearchService(new MemoryChunker(loader), new BM25MemoryIndex(), loader);
    const memoryPath = join(process.cwd(), '.agent-qa/memory.md');

    const result = await service.search({ memoryPath, query: 'login', limit: 5, types: ['route'] });
    expect(result.chunks.every((item) => item.chunk.type === 'route')).toBe(true);
  });
});
