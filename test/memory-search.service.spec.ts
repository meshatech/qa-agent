import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';

let tempDirs: string[] = [];

describe('MemorySearchService', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('searches real fixture terms and filters by type', async () => {
    const loader = new MemoryMarkdownLoader();
    const service = new MemorySearchService(new MemoryChunker(loader), new BM25MemoryIndex(), loader);
    const result = await service.search({
      memoryPath: join(process.cwd(), 'test/fixtures/agent-qa-memory.sample.md'),
      query: 'login',
      limit: 3,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.chunk.id).toBe('ROUTE-TEST-LOGIN-001');

    const routesOnly = await service.search({
      memoryPath: join(process.cwd(), 'test/fixtures/agent-qa-memory.sample.md'),
      query: 'login',
      limit: 5,
      types: ['route'],
    });
    expect(routesOnly.chunks.every((item) => item.chunk.type === 'route')).toBe(true);
  });

  it('returns warnings for missing or empty memory without throwing', async () => {
    const loader = new MemoryMarkdownLoader();
    const service = new MemorySearchService(new MemoryChunker(loader), new BM25MemoryIndex(), loader);
    const projectPath = await tempProjectDir();

    const missing = await service.search({ projectPath, query: 'login', limit: 5 });
    expect(missing.chunks).toEqual([]);
    expect(missing.warnings[0]).toContain('not found');

    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(projectPath, '.agent-qa', 'memory.md'), '   ', 'utf8');
    const empty = await service.search({ projectPath, query: 'login', limit: 5 });
    expect(empty.chunks).toEqual([]);
    expect(empty.warnings[0]).toContain('empty');
  });
});

async function tempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-memory-search-'));
  tempDirs.push(dir);
  return dir;
}
