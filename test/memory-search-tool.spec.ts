import { describe, expect, it, vi } from 'vitest';

import { MemorySearchTool, SearchProjectMemoryTool } from '../src/application/tools/built-in/memory-search.tool.js';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';

describe('qa.memory.search', () => {
  it('returns ranked chunks and warnings through the registry', async () => {
    const memorySearch = {
      search: vi.fn(async () => ({
        chunks: [{
          chunk: {
            id: 'ROUTE-TEST-LOGIN-001',
            type: 'route',
            title: 'Login page',
            content: 'login route',
            sourceFile: 'test/fixtures/agent-qa-memory.sample.md',
          },
          relevanceScore: 2.5,
        }],
        warnings: ['sample warning'],
      })),
    };
    const registry = new QaToolRegistry([MemorySearchTool]);

    await expect(registry.execute('qa.memory.search', {
      query: 'login',
      projectPath: '.',
      limit: 5,
    }, {
      metadata: { memorySearch },
    })).resolves.toMatchObject({
      ok: true,
      issues: [],
      result: {
        chunks: [{
          chunk: { id: 'ROUTE-TEST-LOGIN-001' },
          relevanceScore: 2.5,
        }],
        warnings: ['sample warning'],
      },
    });
  });

  it('works without injected memorySearch via default service', async () => {
    const registry = new QaToolRegistry([MemorySearchTool]);

    const result = await registry.execute('qa.memory.search', {
      query: 'login',
      projectPath: process.cwd(),
      limit: 3,
    }, {});

    expect(result).toMatchObject({
      ok: true,
      result: {
        chunks: expect.any(Array),
        warnings: expect.any(Array),
      },
    });
  });

  it('exposes search_project_memory alias with same contract', async () => {
    const registry = new QaToolRegistry([SearchProjectMemoryTool]);

    const result = await registry.execute('search_project_memory', {
      query: 'login',
      projectPath: process.cwd(),
      limit: 2,
    }, {});

    expect(result).toMatchObject({ ok: true });
    expect((result as { result?: { chunks?: unknown[] } }).result?.chunks?.length).toBeGreaterThan(0);
  });
});
