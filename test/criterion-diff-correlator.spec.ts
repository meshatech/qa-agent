import { describe, expect, it } from 'vitest';

import { correlateCriterionWithDiff } from '../src/domain/helpers/criterion-diff-correlator.js';
import { consumeMemorySearchResults } from '../src/domain/helpers/memory-search-consumer.js';
import { consumePrDiffContext } from '../src/domain/helpers/pr-diff-context-consumer.js';
import type { MemorySearchResult } from '../src/domain/schemas/memory.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const BASE_PR_DIFF: PrDiffContext = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature/login',
    title: 'PRJ-11399 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11399',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [{ type: 'added', lineNumber: 1, content: 'validate credentials' }],
      negativeLines: [],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/login'],
  affectedSchemas: [],
};

const ROUTE_MEMORY_CHUNK: MemorySearchResult = {
  chunk: {
    id: 'route-login',
    type: 'route',
    title: 'Login route',
    content: 'Route /login validates user credentials',
    sourceFile: '.agent-qa/memory.md',
  },
  relevanceScore: 0.8,
};

describe('correlateCriterionWithDiff', () => {
  it('correlates a criterion with a matching changed file path', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'Login route validates user credentials',
      prDiff,
      memory,
    });

    expect(result.correlation.file).toBe('src/routes/login.ts');
    expect(result.correlation.score).toBeGreaterThan(0);
    expect(result.correlation.rationale).toContain('changed file path');
    expect(result.relatedFiles).toEqual(['src/routes/login.ts']);
  });

  it('returns zero score when criterion has no overlap with diff', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'Billing invoice export supports CSV format',
      prDiff,
      memory,
    });

    expect(result.correlation.score).toBe(0);
    expect(result.correlation.rationale).toBe(
      'No lexical overlap with changed files or affected routes',
    );
    expect(result.relatedFiles).toEqual([]);
  });

  it('correlates by affected route when route match beats file overlap', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [],
      affectedRoutes: ['/billing'],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'User can open /billing dashboard',
      prDiff,
      memory,
    });

    expect(result.correlation.file).toBeUndefined();
    expect(result.correlation.score).toBeGreaterThan(0);
    expect(result.correlation.rationale).toContain('affected route /billing');
    expect(result.relatedFiles).toEqual([]);
  });

  it('boosts score and sets memoryChunk when memory aligns with criterion', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([ROUTE_MEMORY_CHUNK]);

    const withoutMemory = correlateCriterionWithDiff({
      criterion: 'Login route validates user credentials',
      prDiff,
      memory: consumeMemorySearchResults([]),
    });
    const withMemory = correlateCriterionWithDiff({
      criterion: 'Login route validates user credentials',
      prDiff,
      memory,
    });

    expect(withMemory.correlation.memoryChunk).toBe('route-login');
    expect(withMemory.correlation.score).toBeGreaterThan(withoutMemory.correlation.score);
    expect(withMemory.correlation.rationale).toContain('BM25 memory chunk route-login');
  });

  it('does not force a match when memory is irrelevant', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([
      {
        chunk: {
          id: 'project-qa',
          type: 'project',
          title: 'Agent QA',
          content: 'Unrelated project context',
          sourceFile: '.agent-qa/memory.md',
        },
        relevanceScore: 0.9,
      },
    ]);

    const result = correlateCriterionWithDiff({
      criterion: 'Billing invoice export supports CSV format',
      prDiff,
      memory,
    });

    expect(result.correlation.score).toBe(0);
    expect(result.correlation.memoryChunk).toBeUndefined();
  });
});
