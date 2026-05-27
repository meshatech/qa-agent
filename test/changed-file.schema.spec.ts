import { describe, expect, it } from 'vitest';

import { ChangedFileSchema } from '../src/domain/schemas/changed-file.schema.js';

const ADDED_LINE = {
  type: 'added' as const,
  lineNumber: 12,
  content: 'export function run() {}',
};

const REMOVED_LINE = {
  type: 'removed' as const,
  lineNumber: 11,
  content: 'export function run() { return false; }',
};

const CONTEXT_LINE = {
  type: 'context' as const,
  lineNumber: 10,
  content: 'import { z } from "zod";',
};

const VALID_MODIFIED_FILE = {
  path: 'src/domain/schemas/changed-file.schema.ts',
  status: 'modified' as const,
  kind: 'schema' as const,
  positiveLines: [ADDED_LINE],
  negativeLines: [REMOVED_LINE],
  contextLines: [CONTEXT_LINE],
};

describe('ChangedFileSchema', () => {
  it('accepts a valid modified file with diff line collections', () => {
    expect(ChangedFileSchema.parse(VALID_MODIFIED_FILE)).toEqual(VALID_MODIFIED_FILE);
  });

  it('accepts an added file with empty negativeLines', () => {
    expect(
      ChangedFileSchema.parse({
        path: 'src/new-file.ts',
        status: 'added',
        kind: 'other',
        positiveLines: [ADDED_LINE],
        negativeLines: [],
        contextLines: [],
      }),
    ).toEqual({
      path: 'src/new-file.ts',
      status: 'added',
      kind: 'other',
      positiveLines: [ADDED_LINE],
      negativeLines: [],
      contextLines: [],
    });
  });

  it('accepts a removed file with empty positiveLines', () => {
    expect(
      ChangedFileSchema.parse({
        path: 'src/old-file.ts',
        status: 'removed',
        kind: 'other',
        positiveLines: [],
        negativeLines: [REMOVED_LINE],
        contextLines: [],
      }),
    ).toEqual({
      path: 'src/old-file.ts',
      status: 'removed',
      kind: 'other',
      positiveLines: [],
      negativeLines: [REMOVED_LINE],
      contextLines: [],
    });
  });

  it('rejects missing kind', () => {
    expect(() =>
      ChangedFileSchema.parse({
        path: 'src/example.ts',
        status: 'modified',
        positiveLines: [],
        negativeLines: [],
        contextLines: [],
      }),
    ).toThrow();
  });

  it('rejects empty path', () => {
    expect(() =>
      ChangedFileSchema.parse({
        ...VALID_MODIFIED_FILE,
        path: '',
      }),
    ).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() =>
      ChangedFileSchema.parse({
        ...VALID_MODIFIED_FILE,
        status: 'renamed',
      }),
    ).toThrow();
  });

  it('rejects invalid kind', () => {
    expect(() =>
      ChangedFileSchema.parse({
        ...VALID_MODIFIED_FILE,
        kind: 'unknown',
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      ChangedFileSchema.parse({
        ...VALID_MODIFIED_FILE,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
