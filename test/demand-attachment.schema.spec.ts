import { describe, expect, it } from 'vitest';

import { DemandAttachmentSchema } from '../src/domain/schemas/demand-attachment.schema.js';

const VALID_ATTACHMENT = {
  name: 'spec.pdf',
  url: 'https://example.com/spec.pdf',
  type: 'application/pdf',
};

describe('DemandAttachmentSchema', () => {
  it('accepts a valid attachment with name, url and type', () => {
    expect(DemandAttachmentSchema.parse(VALID_ATTACHMENT)).toEqual(VALID_ATTACHMENT);
  });

  it('rejects empty name', () => {
    expect(() => DemandAttachmentSchema.parse({ ...VALID_ATTACHMENT, name: '' })).toThrow();
  });

  it('rejects invalid url', () => {
    expect(() =>
      DemandAttachmentSchema.parse({ ...VALID_ATTACHMENT, url: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects empty type', () => {
    expect(() => DemandAttachmentSchema.parse({ ...VALID_ATTACHMENT, type: '' })).toThrow();
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      DemandAttachmentSchema.parse({
        ...VALID_ATTACHMENT,
        extraField: 'unexpected',
      }),
    ).toThrow();
  });
});
