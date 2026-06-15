import { describe, expect, it, vi } from 'vitest';

import { MemoryStoreRouterAdapter } from '../src/infra/memory/memory-store-router.adapter.js';
import type { FileMemoryStoreAdapter } from '../src/infra/memory/file-memory-store.adapter.js';
import type { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import type { HybridMemoryStoreAdapter } from '../src/infra/memory/hybrid-memory-store.adapter.js';

function makeStores() {
  const fileStore = {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: ['file'] }),
    upsertPromoted: vi.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
    findFailureFingerprint: vi.fn().mockResolvedValue(null),
    recordFailureFingerprint: vi.fn(),
  } as unknown as FileMemoryStoreAdapter;

  const postgresStore = {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: ['postgres'] }),
    upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 1 }),
    findFailureFingerprint: vi.fn().mockResolvedValue(null),
    recordFailureFingerprint: vi.fn(),
  } as unknown as PostgresMemoryStoreAdapter;

  const hybridStore = {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: ['hybrid'] }),
    upsertPromoted: vi.fn().mockResolvedValue({ inserted: 1, updated: 1 }),
    findFailureFingerprint: vi.fn(),
    recordFailureFingerprint: vi.fn(),
  } as unknown as HybridMemoryStoreAdapter;

  return { fileStore, postgresStore, hybridStore };
}

describe('MemoryStoreRouterAdapter', () => {
  it('search dispatches by input.source, defaulting to file', async () => {
    const { fileStore, postgresStore, hybridStore } = makeStores();
    const router = new MemoryStoreRouterAdapter(fileStore, postgresStore, hybridStore);

    await router.search({ query: 'q', limit: 1, project: { projectId: 'p' } });
    expect(fileStore.search).toHaveBeenCalledTimes(1);

    await router.search({ query: 'q', limit: 1, project: { projectId: 'p' }, source: 'postgres' });
    expect(postgresStore.search).toHaveBeenCalledTimes(1);

    await router.search({ query: 'q', limit: 1, project: { projectId: 'p' }, source: 'hybrid' });
    expect(hybridStore.search).toHaveBeenCalledTimes(1);
  });

  it('upsertPromoted dispatches by writeBack', async () => {
    const { fileStore, postgresStore, hybridStore } = makeStores();
    const router = new MemoryStoreRouterAdapter(fileStore, postgresStore, hybridStore);

    expect(await router.upsertPromoted([], { writeBack: 'off' })).toEqual({ inserted: 0, updated: 0 });
    expect(fileStore.upsertPromoted).not.toHaveBeenCalled();
    expect(postgresStore.upsertPromoted).not.toHaveBeenCalled();

    await router.upsertPromoted([], { writeBack: 'commit' });
    expect(fileStore.upsertPromoted).toHaveBeenCalledTimes(1);

    await router.upsertPromoted([], { writeBack: 'db' });
    expect(postgresStore.upsertPromoted).toHaveBeenCalledTimes(1);

    await router.upsertPromoted([], { writeBack: 'both' });
    expect(hybridStore.upsertPromoted).toHaveBeenCalledTimes(1);
  });

  it('fingerprint methods dispatch by source, defaulting to file', async () => {
    const { fileStore, postgresStore, hybridStore } = makeStores();
    const router = new MemoryStoreRouterAdapter(fileStore, postgresStore, hybridStore);

    await router.findFailureFingerprint('sig', { projectId: 'p' });
    expect(fileStore.findFailureFingerprint).toHaveBeenCalledTimes(1);

    await router.findFailureFingerprint('sig', { projectId: 'p' }, 'postgres');
    expect(postgresStore.findFailureFingerprint).toHaveBeenCalledTimes(1);
  });
});
