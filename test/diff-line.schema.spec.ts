import { describe, expect, it } from 'vitest';

import { DiffLineSchema } from '../src/domain/schemas/diff-line.schema.js';

const VALID_DIFF_LINE = {
  type: 'added' as const,
  lineNumber: 42,
  content: 'return true;',
};

describe('DiffLineSchema', () => {
  it.each(['added', 'removed', 'context'] as const)(
    'accepts a valid diff line with type %s',
    (type) => {
      expect(
        DiffLineSchema.parse({
          ...VALID_DIFF_LINE,
          type,
        }),
      ).toEqual({
        ...VALID_DIFF_LINE,
        type,
      });
    },
  );

  it('accepts empty content', () => {
    expect(
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        content: '',
      }),
    ).toEqual({
      ...VALID_DIFF_LINE,
      content: '',
    });
  });

  it('rejects invalid type', () => {
    expect(() =>
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        type: 'modified',
      }),
    ).toThrow();
  });

  it('rejects lineNumber zero', () => {
    expect(() =>
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        lineNumber: 0,
      }),
    ).toThrow();
  });

  it('rejects negative lineNumber', () => {
    expect(() =>
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        lineNumber: -1,
      }),
    ).toThrow();
  });

  it('rejects non-integer lineNumber', () => {
    expect(() =>
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        lineNumber: 42.5,
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      DiffLineSchema.parse({
        ...VALID_DIFF_LINE,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
