import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const base = {
  baseUrl: 'http://127.0.0.1',
  appDomains: ['127.0.0.1'],
};

describe('RunConfig demand validation', () => {
  it('rejects config without demand', () => {
    expect(() => RunConfigSchema.parse(base)).toThrow(ZodError);
  });

  it('rejects empty demand description', () => {
    expect(() => RunConfigSchema.parse({ ...base, demand: { id: 'D', title: 'Sem demanda', description: '' } })).toThrow(ZodError);
  });

  it('rejects empty acceptance criteria items', () => {
    expect(() => RunConfigSchema.parse({ ...base, demand: { id: 'D', title: 'T', description: 'Validar fluxo', acceptanceCriteria: [''] } })).toThrow(ZodError);
  });
});
