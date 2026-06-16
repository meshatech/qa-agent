import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import type { PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PostgresMemoryStoreAdapter integration', () => {
  let adapter: PostgresMemoryStoreAdapter;
  let pool: Pool;

  beforeAll(async () => {
    adapter = new PostgresMemoryStoreAdapter();
    // Access private pool via reflection for cleanup
    // @ts-expect-error accessing private field for test cleanup
    pool = await adapter.getPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('upserts and searches promoted records', async () => {
    const records: PromotedMemoryRecord[] = [
      {
        id: 'test-integration-1',
        projectId: 'qa-agent',
        type: 'semantic_locator',
        title: 'Test locator',
        content: 'Strategy: testid; Element: btn-submit',
        sourceRunId: 'run-test-1',
        confidence: 0.95,
        promotionStatus: 'promoted',
        contentHash: 'abc123',
      },
    ];

    const result = await adapter.upsertPromoted(records, { writeBack: 'db' });
    expect(result.inserted + result.updated).toBeGreaterThan(0);

    const searchResult = await adapter.search({
      project: { projectId: 'qa-agent' },
      query: 'btn-submit',
      limit: 5,
    });

    expect(searchResult.chunks.length).toBeGreaterThan(0);
    expect(searchResult.warnings.length).toBe(0);

    // Clean up
    await pool.query('DELETE FROM agent_memory_chunks WHERE id = $1', ['test-integration-1']);
  });

  it('finds and records failure fingerprints', async () => {
    const fingerprint = await adapter.recordFailureFingerprint({
      projectId: 'qa-agent',
      failureSignature: 'test-signature-1',
      route: '/test',
      component: 'TestComponent',
      brokenLocator: 'el_001',
      runId: 'run-test-1',
    });

    expect(fingerprint.projectId).toBe('qa-agent');
    expect(fingerprint.failureSignature).toBe('test-signature-1');

    const found = await adapter.findFailureFingerprint('test-signature-1', { projectId: 'qa-agent' });
    expect(found).not.toBeNull();
    expect(found?.occurrences).toBeGreaterThan(0);

    // Clean up
    await pool.query('DELETE FROM qa_failure_fingerprints WHERE project_id = $1 AND failure_signature = $2', ['qa-agent', 'test-signature-1']);
  });
});
