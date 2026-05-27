import { describe, expect, it } from 'vitest';

import {
  classifyChangedFileKind,
  classifyChangedFiles,
} from '../src/infra/github/git-diff-changed-file-classifier.js';

describe('classifyChangedFileKind', () => {
  it.each([
    ['test/example.spec.ts', 'test'],
    ['src/routes/home.ts', 'route'],
    ['src/pages/login.tsx', 'route'],
    ['src/domain/schemas/foo.schema.ts', 'schema'],
    ['src/infra/github/adapter.ts', 'infra'],
    ['doc/README.md', 'docs'],
    ['README.md', 'docs'],
    ['src/application/service.ts', 'other'],
  ] as const)('classifies %s as %s', (path, kind) => {
    expect(classifyChangedFileKind(path)).toBe(kind);
  });

  it('prefers test over other patterns', () => {
    expect(classifyChangedFileKind('test/routes/home.spec.ts')).toBe('test');
  });
});

describe('classifyChangedFiles', () => {
  it('adds kind to parsed changed files', () => {
    expect(
      classifyChangedFiles([
        {
          path: 'src/infra/github/reader.adapter.ts',
          status: 'modified',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ]),
    ).toEqual([
      {
        path: 'src/infra/github/reader.adapter.ts',
        status: 'modified',
        kind: 'infra',
        positiveLines: [],
        negativeLines: [],
        contextLines: [],
      },
    ]);
  });
});
