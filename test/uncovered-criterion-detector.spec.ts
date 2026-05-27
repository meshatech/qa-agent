import { describe, expect, it } from 'vitest';

import { detectUncoveredCriteria } from '../src/domain/helpers/uncovered-criterion-detector.js';
import { createCorrelationItem } from '../src/domain/schemas/correlation-item.schema.js';

describe('detectUncoveredCriteria', () => {
  it('returns no risks when all correlations meet the overlap threshold', () => {
    const correlations = [
      createCorrelationItem({
        criterion: 'Login route validates user credentials',
        file: 'src/routes/login.ts',
        score: 0.25,
        rationale: 'Criterion tokens overlap with changed file path src/routes/login.ts',
      }),
    ];

    const result = detectUncoveredCriteria({
      acceptanceCriteria: ['Login route validates user credentials'],
      correlations,
      minOverlapScore: 0.15,
    });

    expect(result.risks).toEqual([]);
    expect(result.uncoveredCriteria).toEqual([]);
  });

  it('flags a single criterion without diff evidence', () => {
    const criterion = 'Billing invoice export supports CSV format';
    const correlations = [
      createCorrelationItem({
        criterion,
        score: 0,
        rationale: 'No lexical overlap with changed files or affected routes',
      }),
    ];

    const result = detectUncoveredCriteria({
      acceptanceCriteria: [criterion],
      correlations,
      minOverlapScore: 0.15,
    });

    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]?.type).toBe('uncovered_criterion');
    expect(result.risks[0]?.severity).toBe('HIGH');
    expect(result.uncoveredCriteria).toEqual([criterion]);
    expect(result.risks[0]?.description).toContain('Billing invoice export supports CSV format');
  });

  it('flags multiple criteria below the overlap threshold', () => {
    const correlations = [
      createCorrelationItem({
        criterion: 'Billing invoice export supports CSV format',
        score: 0,
        rationale: 'No lexical overlap with changed files or affected routes',
      }),
      createCorrelationItem({
        criterion: 'Login route validates user credentials',
        file: 'src/routes/login.ts',
        score: 0.25,
        rationale: 'Criterion tokens overlap with changed file path src/routes/login.ts',
      }),
      createCorrelationItem({
        criterion: 'Dashboard widgets refresh automatically',
        score: 0.05,
        rationale: 'No lexical overlap with changed files or affected routes',
      }),
    ];

    const result = detectUncoveredCriteria({
      acceptanceCriteria: [
        'Billing invoice export supports CSV format',
        'Login route validates user credentials',
        'Dashboard widgets refresh automatically',
      ],
      correlations,
      minOverlapScore: 0.15,
    });

    expect(result.risks).toHaveLength(2);
    expect(result.uncoveredCriteria).toEqual([
      'Billing invoice export supports CSV format',
      'Dashboard widgets refresh automatically',
    ]);
    expect(result.risks.every((risk) => risk.type === 'uncovered_criterion')).toBe(true);
  });

  it('truncates long criterion text in risk descriptions', () => {
    const criterion = `${'Billing invoice export supports CSV format '.repeat(10).trim()}`;
    const correlations = [
      createCorrelationItem({
        criterion,
        score: 0,
        rationale: 'No lexical overlap with changed files or affected routes',
      }),
    ];

    const result = detectUncoveredCriteria({
      acceptanceCriteria: [criterion],
      correlations,
    });

    expect(result.risks[0]?.description.length).toBeLessThan(criterion.length + 60);
    expect(result.risks[0]?.description).toContain('…');
  });
});
