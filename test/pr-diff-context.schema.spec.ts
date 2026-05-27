import { describe, expect, it } from 'vitest';

import { PrDiffContextSchema } from '../src/domain/schemas/pr-diff-context.schema.js';

const VALID_PR_DIFF_CONTEXT = {
  schemaVersion: 'pr-diff-context.v1' as const,
  pullRequest: {
    prNumber: 42,
    baseBranch: 'main',
    headBranch: 'feature/test',
    title: 'PRJ-11552 — Fix login flow',
    author: 'octocat',
    clickUpTaskId: 'PRJ-11552',
  },
  changedFiles: [
    {
      path: 'src/routes/home.ts',
      status: 'modified' as const,
      kind: 'route' as const,
      positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'new' }],
      negativeLines: [{ type: 'removed' as const, lineNumber: 1, content: 'old' }],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/home'],
  affectedSchemas: [],
};

describe('PrDiffContextSchema', () => {
  it('accepts a valid pr-diff-context.v1 shape', () => {
    expect(PrDiffContextSchema.parse(VALID_PR_DIFF_CONTEXT)).toEqual(VALID_PR_DIFF_CONTEXT);
  });

  it('rejects unknown fields', () => {
    expect(() =>
      PrDiffContextSchema.parse({ ...VALID_PR_DIFF_CONTEXT, rawDiff: 'secret patch' }),
    ).toThrow();
  });
});
