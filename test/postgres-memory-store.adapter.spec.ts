import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import { computeContentHash, type PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

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

function makePoolMock() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const fingerprintOccurrences = new Map<string, number>();
  const fingerprintFirstSeen = new Map<string, string>();
  const query = vi.fn().mockImplementation((sql: string | { text?: string }, params?: unknown[]) => {
    const sqlText = typeof sql === 'string' ? sql : sql.text ?? String(sql);
    queries.push({ sql: sqlText, params: params ?? [] });

    // upsertPromoted — ON CONFLICT with content_hash
    if (sqlText.includes('ON CONFLICT (content_hash)')) {
      const isFirstCall = queries.filter((q) => q.sql.includes('ON CONFLICT (content_hash)')).length === 1;
      return Promise.resolve({ rows: [{ inserted: isFirstCall ? true : false }] });
    }

    // search — agent_memory_chunks
    if (sqlText.includes('agent_memory_chunks')) {
      return Promise.resolve({
        rows: [
          {
            id: 'chunk-1',
            memory_type: 'semantic_locator',
            title: 'Checkout submit button',
            content_markdown: '- **Content**: button[data-testid="checkout-submit"] is the confirmed locator for checkout submit',
            route: '/checkout',
            component: 'CheckoutForm',
          },
        ],
      });
    }

    // failure fingerprint — find
    if (sqlText.includes('qa_failure_fingerprints') && sqlText.includes('SELECT *')) {
      const rows: Array<Record<string, unknown>> = [];
      const sigParam = params?.[1] as string | undefined;
      const count = sigParam ? fingerprintOccurrences.get(sigParam) : undefined;
      if (count !== undefined) {
        rows.push({
          project_id: 'proj-postgres-test',
          failure_signature: sigParam,
          route: null,
          component: null,
          broken_locator: 'button#missing',
          first_seen_run_id: (sigParam ? fingerprintFirstSeen.get(sigParam) : undefined) ?? 'run-1',
          last_seen_run_id: 'run-2',
          occurrences: count,
          suggested_memory_id: null,
        });
      }
      return Promise.resolve({ rows });
    }

    // failure fingerprint — insert / upsert
    if (sqlText.includes('qa_failure_fingerprints') && sqlText.includes('INSERT')) {
      const sig = params?.[1] as string;
      const runId = params?.[5] as string;
      const count = (fingerprintOccurrences.get(sig) ?? 0) + 1;
      fingerprintOccurrences.set(sig, count);
      if (!fingerprintFirstSeen.has(sig)) {
        fingerprintFirstSeen.set(sig, runId);
      }
      return Promise.resolve({
        rows: [{
          project_id: params?.[0] as string,
          failure_signature: sig,
          route: params?.[2] as string | null,
          component: params?.[3] as string | null,
          broken_locator: params?.[4] as string | null,
          first_seen_run_id: fingerprintFirstSeen.get(sig)!,
          last_seen_run_id: runId,
          occurrences: count,
          suggested_memory_id: params?.[6] as string | null,
        }],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  const end = vi.fn(() => Promise.resolve());

  return { query, end, queries };
}

describe('PostgresMemoryStoreAdapter', () => {
  let adapter: PostgresMemoryStoreAdapter;
  let poolMock: ReturnType<typeof makePoolMock>;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://agent_qa:agent_qa@localhost:5433/agent_qa_memory';
    poolMock = makePoolMock();
    vi.spyOn(PostgresMemoryStoreAdapter.prototype as unknown as { getPool(): Promise<{ query: unknown; end: unknown }> }, 'getPool').mockResolvedValue({
      query: poolMock.query,
      end: poolMock.end,
    } as unknown as Awaited<ReturnType<PostgresMemoryStoreAdapter['getPool']>>);
    adapter = new PostgresMemoryStoreAdapter();
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
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it('search returns promoted chunks for the project scoped by BM25 relevance', async () => {
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
    const signature = 'sig-abc123';

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
    expect(found?.lastSeenRunId).toBe('run-2');
  });
});
