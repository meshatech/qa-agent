import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresMemoryStoreAdapter } from '../src/infra/memory/postgres-memory-store.adapter.js';
import { runMemoryStoreMigrations } from '../src/infra/memory/postgres-migration-runner.js';
import type { PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

const databaseUrl = process.env.DATABASE_URL;

// Quick connectivity probe — skip the suite if the DB is not reachable.
// This avoids failures on local dev machines that lack the postgres container.
async function probeDb(): Promise<boolean> {
  if (!databaseUrl) return false;
  try {
    const { Pool } = await import('pg');
    const p = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
    await p.query('SELECT 1');
    await p.end();
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!databaseUrl || !(await probeDb()))('PostgresMemoryStoreAdapter (real DB)', () => {
  let pool: Pool;
  let adapter: PostgresMemoryStoreAdapter;

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl });
    await runMemoryStoreMigrations(pool);
    adapter = new PostgresMemoryStoreAdapter();
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
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

    const found = await adapter.findFailureFingerprint('real-signature-1', { projectId: 'qa-agent' });
    expect(found).not.toBeNull();
    expect(found!.occurrences).toBeGreaterThan(0);
  });
});
