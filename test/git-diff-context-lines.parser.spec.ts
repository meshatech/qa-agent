import { describe, expect, it, afterEach } from 'vitest';

import { parseGitDiffContextLines } from '../src/infra/github/git-diff-context-lines.parser.js';
import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { cleanupGitFixtures, initRepoWithOriginMain } from './helpers/git-fixtures.js';

afterEach(async () => {
  await cleanupGitFixtures();
});

describe('parseGitDiffContextLines', () => {
  it('returns empty array for empty raw diff', () => {
    expect(parseGitDiffContextLines('')).toEqual([]);
  });

  it('returns empty array when hunk has no context lines', () => {
    const rawDiff = [
      'diff --git a/README.md b/README.md',
      'index 1234567..89abcde 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-base',
      '+changed',
    ].join('\n');

    expect(parseGitDiffContextLines(rawDiff)).toEqual([]);
  });

  it('extracts context lines with new-side line numbers', () => {
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

    expect(parseGitDiffContextLines(rawDiff)).toEqual([
      {
        type: 'context',
        lineNumber: 10,
        content: 'import { z } from "zod";',
      },
    ]);
  });

  it('does not treat --- or +++ file headers as context lines', () => {
    const rawDiff = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,2 +1,2 @@',
      ' unchanged',
      '-removed',
      '+added',
    ].join('\n');

    expect(parseGitDiffContextLines(rawDiff)).toEqual([
      {
        type: 'context',
        lineNumber: 1,
        content: 'unchanged',
      },
    ]);
  });

  it('aggregates context lines from multiple files into a flat DiffLine array', () => {
    const rawDiff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' context-a',
      '-old-a',
      '+new-a',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,2 +1,2 @@',
      ' context-b',
      '-old-b',
      '+new-b',
    ].join('\n');

    expect(parseGitDiffContextLines(rawDiff)).toEqual([
      {
        type: 'context',
        lineNumber: 1,
        content: 'context-a',
      },
      {
        type: 'context',
        lineNumber: 1,
        content: 'context-b',
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
      '@@ -1,2 +1,2 @@',
      ' context',
      '-line',
      '+changed',
      '\\ No newline at end of file',
    ].join('\n');

    expect(parseGitDiffContextLines(rawDiff)).toEqual([
      {
        type: 'context',
        lineNumber: 1,
        content: 'context',
      },
    ]);
  });

  it('returns empty array for real git diff without context lines', async () => {
    const repoDir = await initRepoWithOriginMain();
    const adapter = new ExecGitRepositoryAdapter();
    const rawDiff = await adapter.diffPullRequest('main', repoDir);

    expect(parseGitDiffContextLines(rawDiff)).toEqual([]);
  });
});
