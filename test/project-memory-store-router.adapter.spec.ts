import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectMemoryStoreRouterAdapter } from '../src/infra/memory/project-memory-store-router.adapter.js';

const key = { repo: 'meshatech/kriya-web', branch: 'release' };

let savedDbUrl: string | undefined;
beforeEach(() => {
  savedDbUrl = process.env.DATABASE_URL;
});
afterEach(() => {
  if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDbUrl;
  vi.restoreAllMocks();
});

function makeRouter() {
  const file = { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) };
  const pg = { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) };
  const router = new ProjectMemoryStoreRouterAdapter(file as never, pg as never);
  return { router, file, pg };
}

describe('ProjectMemoryStoreRouterAdapter', () => {
  it('routes to the file store when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;
    const { router, file, pg } = makeRouter();
    await router.load(key);
    expect(file.load).toHaveBeenCalledOnce();
    expect(pg.load).not.toHaveBeenCalled();
  });

  it('routes to Postgres when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/qa';
    const { router, file, pg } = makeRouter();
    await router.load(key);
    expect(pg.load).toHaveBeenCalledOnce();
    expect(file.load).not.toHaveBeenCalled();
  });
});
