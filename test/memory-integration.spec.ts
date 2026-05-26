import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';
import { fetchMemoryContextForConfig } from '../src/application/tools/built-in/memory-tool-support.js';
import type { QaToolContext } from '../src/application/tools/qa-tool-context.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const tempProjectDir = join(process.cwd(), 'test-temp-memory-project');
const tempMemoryDir = join(tempProjectDir, '.agent-qa');
const tempMemoryPath = join(tempMemoryDir, 'memory.md');

async function setupTempMemory(): Promise<void> {
  await mkdir(tempMemoryDir, { recursive: true });
  await writeFile(
    tempMemoryPath,
    `<!-- type: scenario | id: SCN-TEST-001 -->

## Cenário de teste

Objetivo: preencher formulário de cadastro.

<!-- type: semantic_locator | id: LOC-NAME-001 -->
Campo **Nome**: input[name="name"]

<!-- type: known_issue | id: ISSUE-TEST-001 -->
- Timeout em modais

<!-- type: runtime_learning | id: LEARN-TEST-001 -->
- Login com email funciona melhor
`,
    'utf8',
  );
}

async function cleanupTempMemory(): Promise<void> {
  await rm(tempProjectDir, { recursive: true, force: true });
}

beforeAll(async () => {
  await setupTempMemory();
});

afterAll(async () => {
  await cleanupTempMemory();
});

describe('MemorySearchService real integration', () => {
  it('returns chunks when memory.md has searchable content', async () => {
    const service = new MemorySearchService(
      new MemoryChunker(new MemoryMarkdownLoader()),
      new BM25MemoryIndex(),
      new MemoryMarkdownLoader(),
    );

    const result = await service.search({
      projectPath: tempProjectDir,
      query: 'formulário cadastro',
      limit: 5,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBe(0);
  });

  it('returns empty chunks when memory.md does not exist', async () => {
    const service = new MemorySearchService(
      new MemoryChunker(new MemoryMarkdownLoader()),
      new BM25MemoryIndex(),
      new MemoryMarkdownLoader(),
    );

    const result = await service.search({
      projectPath: join(process.cwd(), 'nonexistent'),
      query: 'formulário',
      limit: 5,
    });

    expect(result.chunks).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/not found/);
  });
});

describe('fetchMemoryContextForConfig with real MemorySearchService', () => {
  it('returns memory chunks via real service instead of stub', async () => {
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D1', title: 'Preencher cadastro', description: 'formulário de cadastro' },
    });

    const service = new MemorySearchService(
      new MemoryChunker(new MemoryMarkdownLoader()),
      new BM25MemoryIndex(),
      new MemoryMarkdownLoader(),
    );

    const context: QaToolContext = {
      runId: 'run-1',
      config,
      runDir: tempProjectDir,
      metadata: {
        memorySearch: service,
      },
    };

    const result = await fetchMemoryContextForConfig(config, context, 5);

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBe(0);
  });
});
