import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../src/domain/schemas/changed-file.schema.js';
import {
  detectAffectedSchemas,
  extractSchemaIdentifierFromChangedFilePath,
} from '../src/infra/github/git-diff-affected-schemas.detector.js';

function createSchemaFile(path: string): ChangedFile {
  return {
    path,
    status: 'modified',
    kind: 'schema',
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

function createChangedFile(path: string, kind: ChangedFile['kind']): ChangedFile {
  return {
    path,
    status: 'modified',
    kind,
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

describe('extractSchemaIdentifierFromChangedFilePath', () => {
  it.each([
    ['src/domain/schemas/changed-file.schema.ts', 'changed-file'],
    ['src/domain/schemas/pull-request-context.schema.ts', 'pull-request-context'],
    ['packages/foo/schemas/bar.schema.ts', 'bar'],
    ['src/domain/schemas/helper.ts', 'src/domain/schemas/helper'],
  ] as const)('maps %s to %s', (path, schemaId) => {
    expect(extractSchemaIdentifierFromChangedFilePath(path)).toBe(schemaId);
  });

  it('returns undefined for empty path', () => {
    expect(extractSchemaIdentifierFromChangedFilePath('')).toBeUndefined();
  });
});

describe('detectAffectedSchemas', () => {
  it('returns only schema identifiers from changed files classified as schema', () => {
    expect(
      detectAffectedSchemas([
        createSchemaFile('src/domain/schemas/changed-file.schema.ts'),
        createChangedFile('src/routes/home.ts', 'route'),
        createChangedFile('README.md', 'docs'),
      ]),
    ).toEqual(['changed-file']);
  });

  it('deduplicates and sorts affected schemas deterministically', () => {
    expect(
      detectAffectedSchemas([
        createSchemaFile('src/domain/schemas/zeta.schema.ts'),
        createSchemaFile('packages/foo/schemas/alpha.schema.ts'),
        createSchemaFile('src/domain/schemas/zeta.schema.ts'),
      ]),
    ).toEqual(['alpha', 'zeta']);
  });

  it('returns empty array when no schema files changed', () => {
    expect(detectAffectedSchemas([])).toEqual([]);
    expect(detectAffectedSchemas([createChangedFile('README.md', 'docs')])).toEqual([]);
  });
});
