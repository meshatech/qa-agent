import { describe, expect, it } from 'vitest';

import { RiskItemSchema, createRiskItem } from '../src/domain/schemas/risk-item.schema.js';

const VALID_REGRESSION_RISK = {
  severity: 'MEDIUM' as const,
  description: '3 removed line(s) in src/routes/login.ts may indicate regression risk',
  relatedFile: 'src/routes/login.ts',
  type: 'regression' as const,
};

const VALID_UNCOVERED_RISK = {
  severity: 'HIGH' as const,
  description: 'Acceptance criterion has no related changed file or route: "Billing export CSV"',
  type: 'uncovered_criterion' as const,
};

describe('RiskItemSchema', () => {
  it('accepts a valid regression risk with relatedFile', () => {
    expect(RiskItemSchema.parse(VALID_REGRESSION_RISK)).toEqual(VALID_REGRESSION_RISK);
  });

  it('accepts a valid uncovered_criterion risk without relatedFile', () => {
    expect(RiskItemSchema.parse(VALID_UNCOVERED_RISK)).toEqual(VALID_UNCOVERED_RISK);
  });

  it('rejects empty description', () => {
    expect(() => RiskItemSchema.parse({ ...VALID_REGRESSION_RISK, description: '' })).toThrow();
  });

  it('rejects invalid severity', () => {
    expect(() =>
      RiskItemSchema.parse({ ...VALID_REGRESSION_RISK, severity: 'CRITICAL' }),
    ).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() => RiskItemSchema.parse({ ...VALID_REGRESSION_RISK, type: 'unknown' })).toThrow();
  });

  it('rejects unknown fields under strict mode', () => {
    expect(() => RiskItemSchema.parse({ ...VALID_REGRESSION_RISK, extra: 'field' })).toThrow();
  });

  it('createRiskItem returns the same value as parse', () => {
    expect(createRiskItem(VALID_REGRESSION_RISK)).toEqual(RiskItemSchema.parse(VALID_REGRESSION_RISK));
  });
});
