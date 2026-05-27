import { describe, expect, it } from 'vitest';

import { computeScenarioRiskScore } from '../src/domain/helpers/scenario-risk-scorer.js';
import { createCorrelationItem } from '../src/domain/schemas/correlation-item.schema.js';
import { createRiskItem } from '../src/domain/schemas/risk-item.schema.js';

const BASE_CORRELATION = {
  criterion: 'Login route validates user credentials',
  file: 'src/routes/login.ts',
  rationale: 'Criterion tokens overlap with changed file path src/routes/login.ts',
};

describe('computeScenarioRiskScore', () => {
  it('returns low risk when correlation score is high', () => {
    const riskScore = computeScenarioRiskScore({
      correlation: createCorrelationItem({ ...BASE_CORRELATION, score: 0.8 }),
      relatedFiles: ['src/routes/login.ts'],
      risks: [],
    });

    expect(riskScore).toBeCloseTo(0.2);
  });

  it('returns high risk when correlation score is low', () => {
    const riskScore = computeScenarioRiskScore({
      correlation: createCorrelationItem({ ...BASE_CORRELATION, score: 0.2 }),
      relatedFiles: ['src/routes/login.ts'],
      risks: [],
    });

    expect(riskScore).toBeCloseTo(0.8);
  });

  it('adds regression penalty when a related file has regression risk', () => {
    const riskScore = computeScenarioRiskScore({
      correlation: createCorrelationItem({ ...BASE_CORRELATION, score: 0.8 }),
      relatedFiles: ['src/routes/login.ts'],
      risks: [
        createRiskItem({
          severity: 'MEDIUM',
          description: '1 removed line(s) in src/routes/login.ts may indicate regression risk',
          relatedFile: 'src/routes/login.ts',
          type: 'regression',
        }),
      ],
    });

    expect(riskScore).toBeCloseTo(0.45);
  });

  it('returns zero risk when correlation score is perfect and there is no regression', () => {
    const riskScore = computeScenarioRiskScore({
      correlation: createCorrelationItem({ ...BASE_CORRELATION, score: 1 }),
      relatedFiles: ['src/routes/login.ts'],
      risks: [],
    });

    expect(riskScore).toBe(0);
  });

  it('always returns a score between 0 and 1', () => {
    const riskScore = computeScenarioRiskScore({
      correlation: createCorrelationItem({ ...BASE_CORRELATION, score: 0.2 }),
      relatedFiles: ['src/routes/login.ts'],
      risks: [
        createRiskItem({
          severity: 'HIGH',
          description: 'Regression risk',
          relatedFile: 'src/routes/login.ts',
          type: 'regression',
        }),
      ],
    });

    expect(riskScore).toBeGreaterThanOrEqual(0);
    expect(riskScore).toBeLessThanOrEqual(1);
  });
});
