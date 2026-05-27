import { describe, expect, it, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { parseGitDiffChangedFiles } from '../src/infra/github/git-diff-changed-files.parser.js';
import { classifyChangedFiles } from '../src/infra/github/git-diff-changed-file-classifier.js';
import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { cleanupGitFixtures, initRepoWithOriginMain } from './helpers/git-fixtures.js';

afterEach(async () => {
  await cleanupGitFixtures();
});

describe('parseGitDiffChangedFiles', () => {
  it('returns empty array for empty raw diff', () => {
    expect(parseGitDiffChangedFiles('')).toEqual([]);
  });

  it('parses a modified file with positive and negative lines', () => {
    const rawDiff = [
      'diff --git a/README.md b/README.md',
      'index 1234567..89abcde 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-base',
      '+changed',
    ].join('\n');

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([
      {
        path: 'README.md',
        status: 'modified',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 1,
            content: 'changed',
          },
        ],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 1,
            content: 'base',
          },
        ],
        contextLines: [],
      },
    ]);
  });

  it('parses context lines within a modified file', () => {
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

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([
      {
        path: 'src/example.ts',
        status: 'modified',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 11,
            content: 'export function new() {}',
          },
          {
            type: 'added',
            lineNumber: 12,
            content: 'export function extra() {}',
          },
        ],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 11,
            content: 'export function old() {}',
          },
        ],
        contextLines: [
          {
            type: 'context',
            lineNumber: 10,
            content: 'import { z } from "zod";',
          },
        ],
      },
    ]);
  });

  it('parses added files from /dev/null', () => {
    const rawDiff = [
      'diff --git a/src/new-file.ts b/src/new-file.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new-file.ts',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n');

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([
      {
        path: 'src/new-file.ts',
        status: 'added',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 1,
            content: 'hello',
          },
        ],
        negativeLines: [],
        contextLines: [],
      },
    ]);
  });

  it('parses removed files to /dev/null', () => {
    const rawDiff = [
      'diff --git a/src/old-file.ts b/src/old-file.ts',
      'deleted file mode 100644',
      '--- a/src/old-file.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-goodbye',
    ].join('\n');

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([
      {
        path: 'src/old-file.ts',
        status: 'removed',
        positiveLines: [],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 1,
            content: 'goodbye',
          },
        ],
        contextLines: [],
      },
    ]);
  });

  it('parses multiple files and skips binary diffs', () => {
    const rawDiff = [
      'diff --git a/bin.dat b/bin.dat',
      'Binary files a/bin.dat and b/bin.dat differ',
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-first',
      '+updated',
    ].join('\n');

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([
      {
        path: 'a.txt',
        status: 'modified',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 1,
            content: 'updated',
          },
        ],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 1,
            content: 'first',
          },
        ],
        contextLines: [],
      },
    ]);
  });

  it('skips binary files and logs warning', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const rawDiff = [
      'diff --git a/bin.dat b/bin.dat',
      'Binary files a/bin.dat and b/bin.dat differ',
    ].join('\n');

    expect(parseGitDiffChangedFiles(rawDiff)).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('Skipping binary file in PR diff: bin.dat');

    warnSpy.mockRestore();
  });

  it('parses changed files from real git diff output', async () => {
    const repoDir = await initRepoWithOriginMain();
    const adapter = new ExecGitRepositoryAdapter();
    const rawDiff = await adapter.diffPullRequest('main', repoDir);

    expect(classifyChangedFiles(parseGitDiffChangedFiles(rawDiff))).toEqual([
      {
        path: 'README.md',
        status: 'modified',
        kind: 'docs',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 1,
            content: 'changed',
          },
        ],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 1,
            content: 'base',
          },
        ],
        contextLines: [],
      },
    ]);
  });
});
