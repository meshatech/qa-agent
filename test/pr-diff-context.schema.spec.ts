import { describe, expect, it } from 'vitest';

import type { PrContextReadResult } from '../src/application/ports/github-actions-pr-context-reader.port.js';
import {
  PrDiffContextSchema,
  buildPrDiffContextFromReadResult,
} from '../src/domain/schemas/pr-diff-context.schema.js';

const VALID_PR_DIFF_CONTEXT = {
  schemaVersion: 'pr-diff-context.v1' as const,
  pullRequest: {
    prNumber: 42,
    baseBranch: 'main',
    headBranch: 'feature/test',
    title: 'Fix login flow',
    author: 'octocat',
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

describe('buildPrDiffContextFromReadResult', () => {
  it('maps read result without rawDiff', () => {
    const readResult: PrContextReadResult = {
      pullRequest: VALID_PR_DIFF_CONTEXT.pullRequest,
      rawDiff: 'diff --git a/file.ts b/file.ts\n',
      changedFiles: VALID_PR_DIFF_CONTEXT.changedFiles,
      affectedRoutes: VALID_PR_DIFF_CONTEXT.affectedRoutes,
      affectedSchemas: VALID_PR_DIFF_CONTEXT.affectedSchemas,
    };

    const context = buildPrDiffContextFromReadResult(readResult);

    expect(context).toEqual(VALID_PR_DIFF_CONTEXT);
    expect('rawDiff' in context).toBe(false);
    expect(PrDiffContextSchema.parse(context)).toEqual(VALID_PR_DIFF_CONTEXT);
  });
});
