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

describe('RunConfig scenarioSelection validation', () => {
  const baseWithDemand = {
    baseUrl: 'http://127.0.0.1',
    appDomains: ['127.0.0.1'],
    demand: { id: 'D', title: 'Test', description: 'Test' },
  };

  it('default maxScenarios is 5 when absent', () => {
    const result = RunConfigSchema.parse(baseWithDemand);
    expect(result.scenarioSelection.maxScenarios).toBe(5);
  });

  it('accepts maxScenarios = 1', () => {
    const result = RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: 1 } });
    expect(result.scenarioSelection.maxScenarios).toBe(1);
  });

  it('accepts maxScenarios = 100', () => {
    const result = RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: 100 } });
    expect(result.scenarioSelection.maxScenarios).toBe(100);
  });

  it('rejects maxScenarios = 0', () => {
    expect(() => RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: 0 } })).toThrow(ZodError);
  });

  it('rejects maxScenarios = -1', () => {
    expect(() => RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: -1 } })).toThrow(ZodError);
  });

  it('rejects maxScenarios = 101', () => {
    expect(() => RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: 101 } })).toThrow(ZodError);
  });

  it('rejects decimal maxScenarios', () => {
    expect(() => RunConfigSchema.parse({ ...baseWithDemand, scenarioSelection: { maxScenarios: 2.5 } })).toThrow(ZodError);
  });
});
