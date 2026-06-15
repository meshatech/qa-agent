import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { FileMemoryStoreAdapter } from '../src/infra/memory/file-memory-store.adapter.js';
import { MemoryMarkdownLoader, MEMORY_HEADER_V1 } from '../src/application/services/memory-markdown-loader.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';
import type { PromotedMemoryRecord } from '../src/domain/schemas/memory-record.schema.js';

let tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-file-memory-store-'));
  tempDirs.push(dir);
  return dir;
}

function makeAdapter(): FileMemoryStoreAdapter {
  const loader = new MemoryMarkdownLoader();
  const chunker = new MemoryChunker(loader);
  const index = new BM25MemoryIndex();
  const search = new MemorySearchService(chunker, index, loader);
  return new FileMemoryStoreAdapter(search, loader);
}

function record(overrides: Partial<PromotedMemoryRecord> = {}): PromotedMemoryRecord {
  return {
    id: 'SEMANTIC-LOCATOR-1',
    projectId: 'proj',
    type: 'semantic_locator',
    title: 'Account menu trigger',
    content: '- **Content**: button[data-testid="account-menu"]',
    confidence: 0.9,
    promotionStatus: 'promoted',
    sourceRunId: 'run-1',
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('FileMemoryStoreAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('search delegates to MemorySearchService over memory.md', async () => {
    const projectPath = await tempDir();
    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(
      join(projectPath, '.agent-qa', 'memory.md'),
      `${MEMORY_HEADER_V1}\n\n## Account menu\n\n<!-- type: semantic_locator | id: ACCOUNT-MENU -->\nLocator for account menu trigger\n`,
      'utf8',
    );

    const adapter = makeAdapter();
    const result = await adapter.search({
      projectPath,
      query: 'account menu',
      limit: 5,
      project: { projectId: projectPath },
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.chunk.id).toBe('ACCOUNT-MENU');
  });

  it('upsertPromoted writes only when writeBack is commit or both', async () => {
    const projectPath = await tempDir();
    const adapter = makeAdapter();

    const off = await adapter.upsertPromoted([record()], { writeBack: 'off', projectPath });
    expect(off).toEqual({ inserted: 0, updated: 0 });

    const db = await adapter.upsertPromoted([record()], { writeBack: 'db', projectPath });
    expect(db).toEqual({ inserted: 0, updated: 0 });

    const commit = await adapter.upsertPromoted([record()], { writeBack: 'commit', projectPath });
    expect(commit).toEqual({ inserted: 1, updated: 0 });

    const content = await readFile(join(projectPath, '.agent-qa', 'memory.md'), 'utf8');
    expect(content.split(/\r?\n/)[0]).toBe(MEMORY_HEADER_V1);
    expect(content).toContain('Account menu trigger');
    expect(content).toContain('<!-- type: semantic_locator | id: SEMANTIC-LOCATOR-1 -->');
  });

  it('records and retrieves failure fingerprints from a local JSON file', async () => {
    const projectPath = await tempDir();
    const adapter = makeAdapter();
    const scope = { projectId: projectPath };

    expect(await adapter.findFailureFingerprint('sig-1', scope)).toBeNull();

    const first = await adapter.recordFailureFingerprint({
      projectId: projectPath,
      failureSignature: 'sig-1',
      brokenLocator: 'button#missing',
      runId: 'run-1',
    });
    expect(first.occurrences).toBe(1);

    const second = await adapter.recordFailureFingerprint({
      projectId: projectPath,
      failureSignature: 'sig-1',
      brokenLocator: 'button#missing',
      runId: 'run-2',
      suggestedMemoryId: 'SEMANTIC-LOCATOR-1',
    });
    expect(second.occurrences).toBe(2);
    expect(second.suggestedMemoryId).toBe('SEMANTIC-LOCATOR-1');

    const found = await adapter.findFailureFingerprint('sig-1', scope);
    expect(found?.occurrences).toBe(2);
    expect(found?.lastSeenRunId).toBe('run-2');
  });
});
