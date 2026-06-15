import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';

const fixturePath = join(process.cwd(), 'test/fixtures/agent-qa-memory.sample.md');

function createChunker(): MemoryChunker {
  return new MemoryChunker(new MemoryMarkdownLoader());
}

describe('MemoryChunker', () => {
  afterEach(async () => {
    const original = await readFile(fixturePath, 'utf8');
    await writeFile(fixturePath, original, 'utf8');
  });

  it('parses typed markdown sections without mutating the source file', async () => {
    const chunker = createChunker();
    const before = await readFile(fixturePath, 'utf8');
    const result = await chunker.loadFromFile(fixturePath);

    expect(result.chunks).toHaveLength(4);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([
      'ROUTE-TEST-LOGIN-001',
      'ROUTE-TEST-DASHBOARD-001',
      'LOC-TEST-LOGIN-001',
      'FLOW-TEST-LOGIN-001',
    ]);
    expect(result.warnings.some((warning) => warning.includes('Invalid section without metadata'))).toBe(true);
    await expect(readFile(fixturePath, 'utf8')).resolves.toBe(before);
  });

  it('filters chunks by requested type', async () => {
    const chunker = createChunker();
    const result = await chunker.loadFromFile(fixturePath, { types: ['route'] });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks.every((chunk) => chunk.type === 'route')).toBe(true);
  });

  it('rejects chunks with duplicate ids and reports a rejection summary', () => {
    const chunker = createChunker();
    const text = [
      '## First locator',
      '<!-- type: semantic_locator | id: LOC-001 -->',
      'first',
      '',
      '## Second locator',
      '<!-- type: semantic_locator | id: LOC-001 -->',
      'second',
    ].join('\n');

    const result = chunker.parse(text, 'memory.md');

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.content).toBe('first');
    expect(result.warnings.some((warning) => warning.includes('duplicate chunk id "LOC-001"'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Rejected 1 invalid memory chunk(s)'))).toBe(true);
  });
});
