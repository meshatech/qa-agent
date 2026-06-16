import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { PostgresMemoryStoreAdapter as AdapterType } from '../src/infra/memory/postgres-memory-store.adapter.js';
import type { PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

describe('PostgresMemoryStoreAdapter (mocked)', () => {
  let adapter: AdapterType;

  beforeEach(async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/test');

    // Reset module cache so pg gets re-mocked on import
    vi.resetModules();

    // Dynamically mock pg before importing the adapter
    vi.doMock('pg', () => ({
      Pool: vi.fn().mockImplementation(function () {
        return { query: mockQuery, end: mockEnd };
      }),
    }));

    vi.doMock('../src/infra/memory/postgres-migration-runner.js', () => ({
      runMemoryStoreMigrations: vi.fn().mockResolvedValue(undefined),
    }));

    const { PostgresMemoryStoreAdapter } = await import('../src/infra/memory/postgres-memory-store.adapter.js');
    adapter = new PostgresMemoryStoreAdapter();
    mockQuery.mockClear();
    mockEnd.mockClear();
  });

  it('upserts promoted records and reports counts', async () => {
    mockQuery.mockResolvedValue({ rows: [{ inserted: 1, updated: 0 }] });

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
    expect(mockQuery).toHaveBeenCalled();
  });

  it('searches memory chunks', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'chunk-1',
          memory_type: 'semantic_locator',
          title: 'btn-submit',
          content_markdown: 'Strategy: testid; Element: btn-submit',
          source_run_id: 'run-test-1',
          confidence: 0.95,
          promotion_status: 'promoted',
          project_id: 'qa-agent',
          route: '/test',
          created_at: new Date().toISOString(),
        },
      ],
    });

    const searchResult = await adapter.search({
      project: { projectId: 'qa-agent' },
      query: 'btn-submit',
      limit: 5,
    });

    expect(searchResult.chunks.length).toBeGreaterThan(0);
    expect(searchResult.warnings.length).toBe(0);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('records and finds failure fingerprints', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            project_id: 'qa-agent',
            failure_signature: 'test-signature-1',
            route: '/test',
            component: 'TestComponent',
            broken_locator: 'el_001',
            first_seen_run_id: 'run-test-1',
            last_seen_run_id: 'run-test-1',
            occurrences: 1,
            suggested_memory_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            project_id: 'qa-agent',
            failure_signature: 'test-signature-1',
            route: '/test',
            component: 'TestComponent',
            broken_locator: 'el_001',
            first_seen_run_id: 'run-test-1',
            last_seen_run_id: 'run-test-1',
            occurrences: 1,
            suggested_memory_id: null,
          },
        ],
      });

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
    expect(mockQuery).toHaveBeenCalled();
  });
});
