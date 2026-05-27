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

  it('keeps route file in relatedFiles when route match beats file overlap', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/routes/billing/dashboard.ts',
          status: 'modified',
          kind: 'route',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
        {
          path: 'src/components/widget.tsx',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: ['/billing/dashboard/page'],
      affectedSchemas: [],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'Visit /billing/dashboard/page now',
      prDiff,
      memory,
    });

    expect(result.correlation.rationale).toContain('affected route /billing/dashboard/page');
    expect(result.relatedFiles).toEqual(['src/routes/billing/dashboard.ts']);
    expect(result.correlation.file).toBe('src/routes/billing/dashboard.ts');
  });

  it('resolves schema changed file path instead of schema identifier in relatedFiles', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/domain/schemas/user.schema.ts',
          status: 'modified',
          kind: 'schema',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: [],
      affectedSchemas: ['user'],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'User schema validates email fields',
      prDiff,
      memory,
    });

    expect(result.relatedFiles).toEqual(['src/domain/schemas/user.schema.ts']);
    expect(result.relatedFiles).not.toEqual(['user']);
    expect(result.correlation.file).toBe('src/domain/schemas/user.schema.ts');
  });

  it('includes all changed files with lexical overlap in relatedFiles', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/filters/filter-status.ts',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
        {
          path: 'src/filters/filter-date.ts',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
        {
          path: 'src/components/unrelated.tsx',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: [],
      affectedSchemas: [],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'filter status and filter date validation',
      prDiff,
      memory,
    });

    expect(result.relatedFiles).toEqual([
      'src/filters/filter-status.ts',
      'src/filters/filter-date.ts',
    ]);
    expect(result.correlation.file).toBeDefined();
    expect(result.relatedFiles).toContain(result.correlation.file);
  });

  it('caps relatedFiles at five paths when many files overlap', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: Array.from({ length: 6 }, (_, index) => ({
        path: `src/filters/filter-term-${index}.ts`,
        status: 'modified' as const,
        kind: 'other' as const,
        positiveLines: [],
        negativeLines: [],
        contextLines: [],
      })),
      affectedRoutes: [],
      affectedSchemas: [],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'filter term filter-term',
      prDiff,
      memory,
    });

    expect(result.relatedFiles).toHaveLength(5);
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

  it('does not boost score when memory chunk only matches affected route', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([ROUTE_MEMORY_CHUNK]);

    const withoutMemory = correlateCriterionWithDiff({
      criterion: 'Billing invoice export supports CSV format',
      prDiff,
      memory: consumeMemorySearchResults([]),
    });
    const withMemory = correlateCriterionWithDiff({
      criterion: 'Billing invoice export supports CSV format',
      prDiff,
      memory,
    });

    expect(withMemory.correlation.memoryChunk).toBeUndefined();
    expect(withMemory.correlation.score).toBe(withoutMemory.correlation.score);
  });

  it('does not retain a stale file when route match wins without a resolved route file', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/components/widget.tsx',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: ['billing account'],
      affectedSchemas: [],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'widget billing account service user portal',
      prDiff,
      memory,
    });

    expect(result.correlation.rationale).toContain('affected route billing account');
    expect(result.correlation.file).toBeUndefined();
    expect(result.correlation.file).not.toBe('src/components/widget.tsx');
  });

  it('does not retain a stale file or schema id when schema match wins without a resolved schema file', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/models/order.ts',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: [],
      affectedSchemas: ['user'],
    });
    const memory = consumeMemorySearchResults([]);

    const result = correlateCriterionWithDiff({
      criterion: 'user schema validation rules order',
      prDiff,
      memory,
    });

    expect(result.correlation.rationale).toContain('affected schema user');
    expect(result.correlation.file).toBeUndefined();
    expect(result.correlation.file).not.toBe('src/models/order.ts');
    expect(result.correlation.file).not.toBe('user');
  });

  it('scores short schema names using resolved schema file paths', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/domain/schemas/user.schema.ts',
          status: 'modified',
          kind: 'schema',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: [],
      affectedSchemas: ['user'],
    });
    const memory = consumeMemorySearchResults([]);

    const billingResult = correlateCriterionWithDiff({
      criterion: 'Billing invoice export supports CSV format',
      prDiff,
      memory,
    });
    const userResult = correlateCriterionWithDiff({
      criterion: 'User schema validates email fields',
      prDiff,
      memory,
    });

    expect(billingResult.correlation.file).not.toBe('src/domain/schemas/user.schema.ts');
    expect(userResult.correlation.file).toBe('src/domain/schemas/user.schema.ts');
    expect(userResult.correlation.score).toBeGreaterThan(billingResult.correlation.score);
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
