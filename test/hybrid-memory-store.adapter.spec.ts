import { describe, expect, it, vi } from 'vitest';

import { HybridMemoryStoreAdapter } from '../src/infra/memory/hybrid-memory-store.adapter.js';
import type { FileMemoryStoreAdapter } from '../src/infra/memory/file-memory-store.adapter.js';
import type { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import type { MemoryChunk } from '../src/domain/schemas/memory.schema.js';

function chunk(overrides: Partial<MemoryChunk> = {}): MemoryChunk {
  return {
    id: 'CHUNK-1',
    type: 'semantic_locator',
    title: 'Account menu trigger',
    content: 'button[data-testid="account-menu"] is the confirmed locator',
    sourceFile: 'memory.md',
    ...overrides,
  };
}

function makeStores() {
  const fileStore = {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: [] }),
    upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
    findFailureFingerprint: vi.fn(),
    recordFailureFingerprint: vi.fn(),
  } as unknown as FileMemoryStoreAdapter;

  const postgresStore = {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: [] }),
    upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
    findFailureFingerprint: vi.fn(),
    recordFailureFingerprint: vi.fn(),
  } as unknown as PostgresMemoryStoreAdapter;

  return { fileStore, postgresStore };
}

describe('HybridMemoryStoreAdapter', () => {
  it('merges file and postgres results, dedupes overlaps, and re-ranks with BM25', async () => {
    const { fileStore, postgresStore } = makeStores();
    vi.mocked(fileStore.search).mockResolvedValue({
      chunks: [
        { chunk: chunk({ id: 'FILE-1' }), relevanceScore: 1 },
        { chunk: chunk({ id: 'DUP', title: 'Checkout', content: 'account menu shared content' }), relevanceScore: 1 },
      ],
      warnings: ['file warning'],
    });
    vi.mocked(postgresStore.search).mockResolvedValue({
      chunks: [
        { chunk: chunk({ id: 'PG-1', title: 'Checkout submit', sourceFile: 'postgres://agent_memory_chunks' }), relevanceScore: 1 },
        { chunk: chunk({ id: 'DUP-PG', title: 'Checkout', content: 'account menu shared content', sourceFile: 'postgres://agent_memory_chunks' }), relevanceScore: 1 },
      ],
      warnings: ['pg warning'],
    });

    const hybrid = new HybridMemoryStoreAdapter(fileStore, postgresStore);

    const result = await hybrid.search({
      query: 'account menu',
      limit: 10,
      project: { projectId: 'proj' },
    });

    expect(result.warnings).toEqual(['file warning', 'pg warning']);
    // FILE-1 and PG-1 are distinct; DUP/DUP-PG share type+title+content and collapse into one.
    const ids = result.chunks.map((item) => item.chunk.id);
    expect(ids).toContain('FILE-1');
    expect(ids).toContain('PG-1');
    expect(ids.filter((id) => id === 'DUP' || id === 'DUP-PG')).toHaveLength(1);
  });

  it('upsertPromoted aggregates inserted/updated counts from both stores', async () => {
    const { fileStore, postgresStore } = makeStores();
    vi.mocked(fileStore.upsertPromoted).mockResolvedValue({ inserted: 1, updated: 0 });
    vi.mocked(postgresStore.upsertPromoted).mockResolvedValue({ inserted: 0, updated: 1 });

    const hybrid = new HybridMemoryStoreAdapter(fileStore, postgresStore);

    const result = await hybrid.upsertPromoted([], { writeBack: 'both' });
    expect(result).toEqual({ inserted: 1, updated: 1 });
  });
});
