import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { consumePrDiffContext } from '../src/domain/helpers/pr-diff-context-consumer.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const FIXTURES_DIR = join(process.cwd(), 'test/fixtures/pipeline');

describe('consumePrDiffContext', () => {
  it('extracts pullRequest, changedFiles, routes and schemas from a valid context', async () => {
    const prDiff = JSON.parse(
      await readFile(join(FIXTURES_DIR, 'pr-diff-context.json'), 'utf8'),
    ) as PrDiffContext;

    expect(consumePrDiffContext(prDiff)).toEqual({
      pullRequest: prDiff.pullRequest,
      changedFiles: prDiff.changedFiles,
      affectedRoutes: prDiff.affectedRoutes,
      affectedSchemas: prDiff.affectedSchemas,
      hasDiffSignal: true,
    });
  });

  it('returns hasDiffSignal true when only affectedRoutes are present', () => {
    const prDiff: PrDiffContext = {
      schemaVersion: 'pr-diff-context.v1',
      pullRequest: {
        prNumber: 1,
        baseBranch: 'main',
        headBranch: 'feature/login',
        title: 'PRJ-11397 login',
        author: 'dev',
        clickUpTaskId: 'PRJ-11397',
      },
      changedFiles: [],
      affectedRoutes: ['/login'],
      affectedSchemas: [],
    };

    expect(consumePrDiffContext(prDiff).hasDiffSignal).toBe(true);
  });

  it('returns hasDiffSignal false when diff has no files, routes or schemas', () => {
    const prDiff: PrDiffContext = {
      schemaVersion: 'pr-diff-context.v1',
      pullRequest: {
        prNumber: 1,
        baseBranch: 'main',
        headBranch: 'feature/login',
        title: 'PRJ-11397 login',
        author: 'dev',
      },
      changedFiles: [],
      affectedRoutes: [],
      affectedSchemas: [],
    };

    expect(consumePrDiffContext(prDiff).hasDiffSignal).toBe(false);
  });

  it('throws when pr diff context is invalid', () => {
    expect(() =>
      consumePrDiffContext({
        schemaVersion: 'pr-diff-context.v1',
        pullRequest: {
          prNumber: 0,
          baseBranch: 'main',
          headBranch: 'feature/login',
          title: 'PRJ-11397 login',
          author: 'dev',
        },
        changedFiles: [],
        affectedRoutes: [],
        affectedSchemas: [],
      } as PrDiffContext),
    ).toThrow();
  });
});
