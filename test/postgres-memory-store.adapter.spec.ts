import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import { computeContentHash, type PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://agent_qa:agent_qa@localhost:5433/agent_qa_memory';

const describeIfDb = process.env.SKIP_PG_TESTS === '1' ? describe.skip : describe;

function record(overrides: Partial<PromotedMemoryRecord> = {}): PromotedMemoryRecord {
  const unique = Math.random().toString(36).slice(2);
  const base: PromotedMemoryRecord = {
    id: `chunk-${unique}`,
    projectId: 'proj-postgres-test',
    type: 'semantic_locator',
    title: `Account menu trigger ${unique}`,
    content: `- **Content**: button[data-testid="account-menu-${unique}"]`,
    route: '/account',
    component: 'AccountMenu',
    confidence: 0.9,
    promotionStatus: 'promoted',
    sourceRunId: 'run-1',
    contentHash: 'placeholder',
    ...overrides,
  };
  return { ...base, contentHash: computeContentHash(base) };
}

describeIfDb('PostgresMemoryStoreAdapter', () => {
  let adapter: PostgresMemoryStoreAdapter;

  beforeAll(() => {
    process.env.DATABASE_URL = DATABASE_URL;
    adapter = new PostgresMemoryStoreAdapter();
  });

  afterAll(async () => {
    await adapter.onModuleDestroy();
  });

  it('upsertPromoted is idempotent via ON CONFLICT (content_hash)', async () => {
    const rec = record();

    const first = await adapter.upsertPromoted([rec], { writeBack: 'db' });
    expect(first).toEqual({ inserted: 1, updated: 0 });

    const second = await adapter.upsertPromoted([{ ...rec, confidence: 0.95 }], { writeBack: 'db' });
    expect(second).toEqual({ inserted: 0, updated: 1 });
  });

  it('does nothing when writeBack does not include db', async () => {
    const result = await adapter.upsertPromoted([record()], { writeBack: 'commit' });
    expect(result).toEqual({ inserted: 0, updated: 0 });
  });

  it('search returns promoted chunks for the project scoped by BM25 relevance', async () => {
    const rec = record({
      title: 'Checkout submit button',
      content: '- **Content**: button[data-testid="checkout-submit"] is the confirmed locator for checkout submit',
      route: '/checkout',
      component: 'CheckoutForm',
    });
    await adapter.upsertPromoted([rec], { writeBack: 'db' });

    const result = await adapter.search({
      query: 'checkout submit button',
      limit: 5,
      project: { projectId: 'proj-postgres-test', route: '/checkout', component: 'CheckoutForm' },
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.chunk.title).toBe('Checkout submit button');
  });

  it('records and finds failure fingerprints with occurrence counting', async () => {
    const scope = { projectId: 'proj-postgres-test' };
    const signature = `sig-${Math.random().toString(36).slice(2)}`;

    expect(await adapter.findFailureFingerprint(signature, scope)).toBeNull();

    await adapter.recordFailureFingerprint({
      projectId: scope.projectId,
      failureSignature: signature,
      brokenLocator: 'button#missing',
      runId: 'run-1',
    });

    const second = await adapter.recordFailureFingerprint({
      projectId: scope.projectId,
      failureSignature: signature,
      brokenLocator: 'button#missing',
      runId: 'run-2',
    });

    expect(second.occurrences).toBe(2);
    expect(second.firstSeenRunId).toBe('run-1');
    expect(second.lastSeenRunId).toBe('run-2');

    const found = await adapter.findFailureFingerprint(signature, scope);
    expect(found?.occurrences).toBe(2);
  });
});
