import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import type { PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

function makePoolMock() {
  const fingerprintOccurrences = new Map<string, number>();
  const fingerprintFirstSeen = new Map<string, string>();

  const query = vi.fn().mockImplementation((sql: string | { text?: string }, params?: unknown[]) => {
    const sqlText = typeof sql === 'string' ? sql : sql.text ?? String(sql);

    if (sqlText.includes('ON CONFLICT (content_hash)')) {
      return Promise.resolve({ rows: [{ inserted: true }] });
    }

    if (sqlText.includes('agent_memory_chunks') && sqlText.includes('SELECT')) {
      return Promise.resolve({
        rows: [{
          id: 'chunk-1',
          memory_type: 'semantic_locator',
          title: 'Real locator',
          content_markdown: 'Strategy: testid; Element: btn-submit',
          route: '/test',
          component: 'TestComponent',
        }],
      });
    }

    if (sqlText.includes('qa_failure_fingerprints') && sqlText.includes('SELECT')) {
      const sigParam = params?.[1] as string | undefined;
      const count = sigParam ? fingerprintOccurrences.get(sigParam) : undefined;
      if (count !== undefined) {
        return Promise.resolve({
          rows: [{
            project_id: 'qa-agent',
            failure_signature: sigParam,
            route: '/test',
            component: 'TestComponent',
            broken_locator: 'el_001',
            first_seen_run_id: (sigParam ? fingerprintFirstSeen.get(sigParam) : undefined) ?? 'run-real-1',
            last_seen_run_id: 'run-real-1',
            occurrences: count,
            suggested_memory_id: null,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    }

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
  return { query, end };
}

describe('PostgresMemoryStoreAdapter (mocked DB)', () => {
  let adapter: PostgresMemoryStoreAdapter;
  let poolMock: ReturnType<typeof makePoolMock>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://agent_qa:agent_qa@localhost:5433/agent_qa_memory';
    poolMock = makePoolMock();
    vi.spyOn(PostgresMemoryStoreAdapter.prototype as unknown as { getPool(): Promise<{ query: unknown; end: unknown }> }, 'getPool').mockResolvedValue({
      query: poolMock.query,
      end: poolMock.end,
    } as unknown as Awaited<ReturnType<PostgresMemoryStoreAdapter['getPool']>>);
    adapter = new PostgresMemoryStoreAdapter();
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it('upserts promoted records and reports counts', async () => {
    const records: PromotedMemoryRecord[] = [
      {
        id: 'real-test-1',
        projectId: 'qa-agent',
        type: 'semantic_locator',
        title: 'Real locator',
        content: 'Strategy: testid; Element: btn-submit',
        sourceRunId: 'run-real-1',
        confidence: 0.95,
        promotionStatus: 'promoted',
        contentHash: 'abc123',
      },
    ];

    const result = await adapter.upsertPromoted(records, { writeBack: 'db' });
    expect(result.inserted + result.updated).toBeGreaterThan(0);
  });

  it('searches memory chunks', async () => {
    const searchResult = await adapter.search({
      project: { projectId: 'qa-agent' },
      query: 'btn-submit',
      limit: 5,
    });

    expect(searchResult.warnings.length).toBe(0);
    expect(searchResult.chunks.length).toBeGreaterThan(0);
  });

  it('records and finds failure fingerprints', async () => {
    const fingerprint = await adapter.recordFailureFingerprint({
      projectId: 'qa-agent',
      failureSignature: 'real-signature-1',
      route: '/test',
      component: 'TestComponent',
      brokenLocator: 'el_001',
      runId: 'run-real-1',
    });

    expect(fingerprint.projectId).toBe('qa-agent');
    expect(fingerprint.failureSignature).toBe('real-signature-1');
    expect(fingerprint.occurrences).toBe(1);

    const found = await adapter.findFailureFingerprint('real-signature-1', { projectId: 'qa-agent' });
    expect(found).not.toBeNull();
    expect(found!.occurrences).toBeGreaterThan(0);
  });
});
