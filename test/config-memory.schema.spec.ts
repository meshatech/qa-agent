import { describe, expect, it } from 'vitest';

import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const BASE_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173/',
  appDomains: ['127.0.0.1'],
  demand: { id: 'PRJ-TEST', title: 'Test', description: 'Test desc' },
};

describe('RunConfigSchema memory block', () => {
  it('defaults to file source with db write-back when omitted', () => {
    const config = RunConfigSchema.parse(BASE_CONFIG);

    expect(config.memory).toEqual({ source: 'file', writeBack: 'db', schemaVersion: 'v1' });
  });

  it('accepts an explicit hybrid/both configuration', () => {
    const config = RunConfigSchema.parse({
      ...BASE_CONFIG,
      memory: { source: 'hybrid', writeBack: 'both' },
    });

    expect(config.memory).toEqual({ source: 'hybrid', writeBack: 'both', schemaVersion: 'v1' });
  });

  it('rejects an unknown source', () => {
    expect(() =>
      RunConfigSchema.parse({
        ...BASE_CONFIG,
        memory: { source: 'unknown' },
      }),
    ).toThrow();
  });
});
