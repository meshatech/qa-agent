import { describe, expect, it } from 'vitest';

import type { RiskScore, RiskLevel, RiskFactor } from '../src/domain/models/risk-score.model.js';

describe('RiskScore model', () => {
  it('accepts a valid low risk score', () => {
    const score: RiskScore = {
      value: 0.15,
      level: 'low',
      factors: [{ name: 'flaky_locator', weight: 0.2, contribution: 0.15 }],
      calculatedAt: '2024-05-29T10:00:00Z',
    };
    expect(score.value).toBe(0.15);
    expect(score.level).toBe('low');
  });

  it('accepts a valid critical risk score', () => {
    const score: RiskScore = {
      value: 0.92,
      level: 'critical',
      factors: [
        { name: 'consistent_failure', weight: 0.5, contribution: 0.5 },
        { name: 'no_recovery', weight: 0.3, contribution: 0.3 },
        { name: 'data_loss_signal', weight: 0.2, contribution: 0.12 },
      ],
      calculatedAt: '2024-05-29T10:00:00Z',
    };
    expect(score.level).toBe('critical');
    expect(score.factors).toHaveLength(3);
  });

  it('accepts all risk levels', () => {
    const levels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    for (const level of levels) {
      const score: RiskScore = {
        value: 0.5,
        level,
        factors: [],
        calculatedAt: '2024-05-29T10:00:00Z',
      };
      expect(score.level).toBe(level);
    }
  });

  it('validates risk factor structure', () => {
    const factor: RiskFactor = {
      name: 'high_failure_rate',
      weight: 0.4,
      contribution: 0.35,
    };
    expect(factor.name).toBe('high_failure_rate');
    expect(factor.weight).toBe(0.4);
    expect(factor.contribution).toBe(0.35);
  });

  it('accepts empty factors array', () => {
    const score: RiskScore = {
      value: 0.0,
      level: 'low',
      factors: [],
      calculatedAt: '2024-05-29T10:00:00Z',
    };
    expect(score.factors).toHaveLength(0);
  });

  it('accepts edge value boundaries', () => {
    const zeroScore: RiskScore = {
      value: 0,
      level: 'low',
      factors: [],
      calculatedAt: '2024-05-29T10:00:00Z',
    };
    expect(zeroScore.value).toBe(0);

    const maxScore: RiskScore = {
      value: 1,
      level: 'critical',
      factors: [],
      calculatedAt: '2024-05-29T10:00:00Z',
    };
    expect(maxScore.value).toBe(1);
  });
});
