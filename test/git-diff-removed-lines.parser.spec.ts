import { describe, expect, it, afterEach } from 'vitest';

import { parseGitDiffRemovedLines } from '../src/infra/github/git-diff-removed-lines.parser.js';
import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { cleanupGitFixtures, initRepoWithOriginMain } from './helpers/git-fixtures.js';

afterEach(async () => {
  await cleanupGitFixtures();
});

describe('parseGitDiffRemovedLines', () => {
  it('returns empty array for empty raw diff', () => {
    expect(parseGitDiffRemovedLines('')).toEqual([]);
  });

  it('extracts removed lines from a single-file hunk', () => {
    const rawDiff = [
      'diff --git a/README.md b/README.md',
      'index 1234567..89abcde 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-base',
      '+changed',
    ].join('\n');

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 1,
        content: 'base',
      },
    ]);
  });

  it('does not treat --- file headers as removed lines', () => {
    const rawDiff = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-content',
    ].join('\n');

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 1,
        content: 'content',
      },
    ]);
  });

  it('tracks old-side line numbers across context and added lines', () => {
    const rawDiff = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -10,3 +10,4 @@',
      ' import { z } from "zod";',
      '-export function old() {}',
      '+export function new() {}',
      '+export function extra() {}',
    ].join('\n');

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 11,
        content: 'export function old() {}',
      },
    ]);
  });

  it('aggregates removed lines from multiple files into a flat DiffLine array', () => {
    const rawDiff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-first',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-second',
    ].join('\n');

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 1,
        content: 'first',
      },
      {
        type: 'removed',
        lineNumber: 1,
        content: 'second',
      },
    ]);
  });

  it('ignores no-newline markers and binary metadata', () => {
    const rawDiff = [
      'diff --git a/bin.dat b/bin.dat',
      'Binary files a/bin.dat and b/bin.dat differ',
      'diff --git a/text.txt b/text.txt',
      '--- a/text.txt',
      '+++ b/text.txt',
      '@@ -1 +1 @@',
      '-line',
      '\\ No newline at end of file',
    ].join('\n');

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 1,
        content: 'line',
      },
    ]);
  });

  it('parses removed lines from real git diff output', async () => {
    const repoDir = await initRepoWithOriginMain();
    const adapter = new ExecGitRepositoryAdapter();
    const rawDiff = await adapter.diffPullRequest('main', repoDir);

    expect(parseGitDiffRemovedLines(rawDiff)).toEqual([
      {
        type: 'removed',
        lineNumber: 1,
        content: 'base',
      },
    ]);
  });
});
