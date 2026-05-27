import { describe, expect, it } from 'vitest';

import { PullRequestContextSchema } from '../src/domain/schemas/pull-request-context.schema.js';

const VALID_PULL_REQUEST_CONTEXT = {
  prNumber: 42,
  baseBranch: 'main',
  headBranch: 'feature/test',
  title: 'Implementar leitor real de PR/diff via GitHub Actions',
  author: 'jose.neto',
};

describe('PullRequestContextSchema', () => {
  it('accepts a valid pull request context with all fields', () => {
    expect(PullRequestContextSchema.parse(VALID_PULL_REQUEST_CONTEXT)).toEqual(
      VALID_PULL_REQUEST_CONTEXT,
    );
  });

  it('rejects prNumber zero', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, prNumber: 0 }),
    ).toThrow();
  });

  it('rejects negative prNumber', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, prNumber: -1 }),
    ).toThrow();
  });

  it('rejects non-integer prNumber', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, prNumber: 42.5 }),
    ).toThrow();
  });

  it('rejects empty baseBranch', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, baseBranch: '' }),
    ).toThrow();
  });

  it('rejects empty headBranch', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, headBranch: '' }),
    ).toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, title: '' }),
    ).toThrow();
  });

  it('rejects empty author', () => {
    expect(() =>
      PullRequestContextSchema.parse({ ...VALID_PULL_REQUEST_CONTEXT, author: '' }),
    ).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      PullRequestContextSchema.parse({
        ...VALID_PULL_REQUEST_CONTEXT,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
