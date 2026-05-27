import { describe, expect, it } from 'vitest';

import {
  RequiredScenarioSchema,
  createRequiredScenario,
} from '../src/domain/schemas/required-scenario.schema.js';

const VALID_CRITERION_SCENARIO = {
  id: 'required-scenario-1',
  title: 'Login route validates user credentials',
  intent: 'POSITIVE' as const,
  rationale: 'Criterion tokens overlap with changed file path src/routes/login.ts',
  relatedFiles: ['src/routes/login.ts'],
  riskScore: 0.5,
};

const VALID_ROUTE_SCENARIO = {
  id: 'required-scenario-route-1',
  title: 'Validate affected route /login',
  intent: 'POSITIVE' as const,
  rationale: 'Affected route /login changed in PR diff',
  relatedFiles: [] as string[],
  riskScore: 0.8,
};

describe('RequiredScenarioSchema', () => {
  it('accepts a valid criterion-based scenario', () => {
    expect(RequiredScenarioSchema.parse(VALID_CRITERION_SCENARIO)).toEqual(VALID_CRITERION_SCENARIO);
  });

  it('accepts a valid route fallback scenario with empty relatedFiles', () => {
    expect(RequiredScenarioSchema.parse(VALID_ROUTE_SCENARIO)).toEqual(VALID_ROUTE_SCENARIO);
  });

  it('rejects empty id', () => {
    expect(() => RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, id: '' })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, title: '' })).toThrow();
  });

  it('rejects empty rationale', () => {
    expect(() => RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, rationale: '' })).toThrow();
  });

  it('rejects invalid intent', () => {
    expect(() =>
      RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, intent: 'INVALID' }),
    ).toThrow();
  });

  it('rejects riskScore below 0', () => {
    expect(() => RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, riskScore: -0.1 })).toThrow();
  });

  it('rejects riskScore above 1', () => {
    expect(() => RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, riskScore: 1.1 })).toThrow();
  });

  it('rejects unknown fields under strict mode', () => {
    expect(() =>
      RequiredScenarioSchema.parse({ ...VALID_CRITERION_SCENARIO, extra: 'field' }),
    ).toThrow();
  });

  it('createRequiredScenario returns the same value as parse', () => {
    expect(createRequiredScenario(VALID_CRITERION_SCENARIO)).toEqual(
      RequiredScenarioSchema.parse(VALID_CRITERION_SCENARIO),
    );
  });
});
