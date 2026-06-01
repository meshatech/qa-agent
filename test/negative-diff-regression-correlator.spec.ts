import { describe, expect, it } from 'vitest';

import { correlateNegativeDiffRegressions } from '../src/domain/helpers/negative-diff-regression-correlator.js';
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
    title: 'PRJ-11400 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11400',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [{ type: 'added', lineNumber: 1, content: 'validate credentials' }],
      negativeLines: [{ type: 'removed', lineNumber: 2, content: 'legacy auth' }],
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

describe('correlateNegativeDiffRegressions', () => {
  it('creates a regression risk when a file has negative lines', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([]);

    const risks = correlateNegativeDiffRegressions({ prDiff, memory });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe('regression');
    expect(risks[0]?.relatedFile).toBe('src/routes/login.ts');
    expect(risks[0]?.severity).toBe('MEDIUM');
  });

  it('returns no risks when no file has negative lines', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
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
    });
    const memory = consumeMemorySearchResults([]);

    const risks = correlateNegativeDiffRegressions({ prDiff, memory });

    expect(risks).toEqual([]);
  });

  it('uses HIGH severity when more than five lines are removed', () => {
    const negativeLines = Array.from({ length: 6 }, (_, index) => ({
      type: 'removed' as const,
      lineNumber: index + 1,
      content: `removed line ${index + 1}`,
    }));
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'src/routes/login.ts',
          status: 'modified',
          kind: 'route',
          positiveLines: [],
          negativeLines,
          contextLines: [],
        },
      ],
    });
    const memory = consumeMemorySearchResults([]);

    const risks = correlateNegativeDiffRegressions({ prDiff, memory });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.severity).toBe('HIGH');
  });

  it('enriches description when memory chunk aligns with route or path', () => {
    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([ROUTE_MEMORY_CHUNK]);

    const risks = correlateNegativeDiffRegressions({ prDiff, memory });

    expect(risks).toHaveLength(1);
    expect(risks[0]?.description).toContain('memory route route-login');
    expect(risks[0]?.description).toContain('Login route');
  });

  it('keeps base description when memory is irrelevant', () => {
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

    const withoutMemory = correlateNegativeDiffRegressions({
      prDiff,
      memory: consumeMemorySearchResults([]),
    });
    const withIrrelevantMemory = correlateNegativeDiffRegressions({ prDiff, memory });

    expect(withIrrelevantMemory).toHaveLength(1);
    expect(withIrrelevantMemory[0]?.description).toBe(withoutMemory[0]?.description);
    expect(withIrrelevantMemory[0]?.severity).toBe(withoutMemory[0]?.severity);
    expect(withIrrelevantMemory[0]?.description).not.toContain('memory');
  });

  it('ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml)', () => {
    const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    for (const lockFile of lockFiles) {
      const prDiff = consumePrDiffContext({
        ...BASE_PR_DIFF,
        changedFiles: [
          {
            path: lockFile,
            status: 'modified',
            kind: 'other',
            positiveLines: [],
            negativeLines: [{ type: 'removed', lineNumber: 1, content: 'dependency version' }],
            contextLines: [],
          },
        ],
      });
      const risks = correlateNegativeDiffRegressions({ prDiff, memory: consumeMemorySearchResults([]) });
      expect(risks).toHaveLength(0);
    }
  });

  it('ignores config noise files (tsconfig, jest, vitest, eslint, prettier, .env)', () => {
    const configFiles = ['tsconfig.json', 'jest.config.ts', 'vitest.config.ts', '.eslintrc.json', '.prettierrc', '.env.local'];
    for (const configFile of configFiles) {
      const prDiff = consumePrDiffContext({
        ...BASE_PR_DIFF,
        changedFiles: [
          {
            path: configFile,
            status: 'modified',
            kind: 'other',
            positiveLines: [],
            negativeLines: [{ type: 'removed', lineNumber: 1, content: 'config' }],
            contextLines: [],
          },
        ],
      });
      const risks = correlateNegativeDiffRegressions({ prDiff, memory: consumeMemorySearchResults([]) });
      expect(risks).toHaveLength(0);
    }
  });

  it('adds LOW severity dependency_change risk for package.json', () => {
    const prDiff = consumePrDiffContext({
      ...BASE_PR_DIFF,
      changedFiles: [
        {
          path: 'package.json',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [{ type: 'removed', lineNumber: 1, content: '"lodash": "^4.17.0"' }],
          contextLines: [],
        },
      ],
    });
    const risks = correlateNegativeDiffRegressions({ prDiff, memory: consumeMemorySearchResults([]) });
    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe('dependency_change');
    expect(risks[0]?.severity).toBe('LOW');
    expect(risks[0]?.relatedFile).toBe('package.json');
  });
});
