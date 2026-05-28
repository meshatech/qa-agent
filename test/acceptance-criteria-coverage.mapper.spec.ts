import { describe, expect, it } from 'vitest';
import { buildAcceptanceCriteriaCoverageMap, buildUncoveredCriteria } from '../src/application/services/acceptance-criteria-coverage.mapper.js';
import type { QaScenario } from '../src/domain/models/run.model.js';

describe('buildAcceptanceCriteriaCoverageMap', () => {
  it('maps criterion covered by scenario title', () => {
    const scenarios: QaScenario[] = [
      { id: 's1', title: 'Logout do usuário autenticado', status: 'PASSED', tasks: [] },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Usuário consegue fazer logout'],
      scenarios,
    });

    expect(result.length).toBe(1);
    expect(result[0].criterion).toBe('Usuário consegue fazer logout');
    expect(result[0].scenarioId).toBe('s1');
    expect(result[0].source).toBe('lexical');
    expect(result[0].score).toBeGreaterThanOrEqual(0.30);
  });

  it('maps criterion covered by task title', () => {
    const scenarios: QaScenario[] = [
      {
        id: 's1',
        title: 'Login',
        status: 'PASSED',
        tasks: [
          { id: 'T001', title: 'Preencher formulário de login', expected: 'form visible', status: 'PASSED' },
        ],
      },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Preencher formulário de login'],
      scenarios,
    });

    expect(result.length).toBe(1);
    expect(result[0].scenarioId).toBe('s1');
    expect(result[0].evidence).toContain('task.title');
  });

  it('maps criterion covered by task expected', () => {
    const scenarios: QaScenario[] = [
      {
        id: 's1',
        title: 'Login',
        status: 'PASSED',
        tasks: [
          { id: 'T001', title: 'Click button', expected: 'Deve redirecionar para /login', status: 'PASSED' },
        ],
      },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['redirecionar para /login'],
      scenarios,
    });

    expect(result.length).toBe(1);
    expect(result[0].evidence).toContain('task.expected');
  });

  it('returns empty when no match found', () => {
    const scenarios: QaScenario[] = [
      { id: 's1', title: 'Login', status: 'PASSED', tasks: [] },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Gerar relatório fiscal trimestral'],
      scenarios,
    });

    expect(result.length).toBe(0);
  });

  it('selects best score when multiple scenarios match', () => {
    const scenarios: QaScenario[] = [
      { id: 's1', title: 'Login parcial', status: 'PASSED', tasks: [] },
      { id: 's2', title: 'Logout completo do usuário autenticado', status: 'PASSED', tasks: [] },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Usuário consegue fazer logout'],
      scenarios,
    });

    expect(result.length).toBe(1);
    expect(result[0].scenarioId).toBe('s2');
    expect(result[0].score).toBeGreaterThanOrEqual(0.30);
  });

  it('preserves original order on tie', () => {
    const scenarios: QaScenario[] = [
      { id: 's1', title: 'Logout do usuário', status: 'PASSED', tasks: [] },
      { id: 's2', title: 'Logout do usuário', status: 'PASSED', tasks: [] },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Usuário consegue fazer logout'],
      scenarios,
    });

    expect(result.length).toBe(1);
    expect(result[0].scenarioId).toBe('s1');
  });

  it('returns empty when acceptanceCriteria is empty', () => {
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: [],
      scenarios: [{ id: 's1', title: 'Login', status: 'PASSED', tasks: [] }],
    });
    expect(result.length).toBe(0);
  });

  it('returns empty when scenarios is empty', () => {
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Usuário consegue fazer logout'],
      scenarios: [],
    });
    expect(result.length).toBe(0);
  });

  it('respects custom minScore', () => {
    const scenarios: QaScenario[] = [
      { id: 's1', title: 'Logout', status: 'PASSED', tasks: [] },
    ];
    const result = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: ['Usuário consegue fazer logout'],
      scenarios,
      minScore: 0.90,
    });

    expect(result.length).toBe(0);
  });
});

describe('buildUncoveredCriteria', () => {
  it('returns criteria not present in coverageMap', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['Login funciona', 'Logout funciona'],
      coverageMap: [
        { criterion: 'Login funciona', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical' },
      ],
    });

    expect(result).toEqual(['Logout funciona']);
  });

  it('returns empty when all criteria are covered', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['Login funciona'],
      coverageMap: [
        { criterion: 'Login funciona', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical' },
      ],
    });

    expect(result).toEqual([]);
  });

  it('preserves original order of uncovered criteria', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['A', 'B', 'C'],
      coverageMap: [
        { criterion: 'B', scenarioId: 's1', scenarioTitle: 'B', score: 0.72, source: 'lexical' },
      ],
    });

    expect(result).toEqual(['A', 'C']);
  });

  it('normalizes whitespace and case when matching', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['  LOGIN funciona  '],
      coverageMap: [
        { criterion: 'login funciona', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical' },
      ],
    });

    expect(result).toEqual([]);
  });

  it('returns all criteria when coverageMap is empty', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['Login funciona', 'Logout funciona'],
      coverageMap: [],
    });

    expect(result).toEqual(['Login funciona', 'Logout funciona']);
  });

  it('returns empty when acceptanceCriteria is empty', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: [],
      coverageMap: [],
    });

    expect(result).toEqual([]);
  });

  it('ignores empty or whitespace-only criteria', () => {
    const result = buildUncoveredCriteria({
      acceptanceCriteria: ['Login funciona', '', '   '],
      coverageMap: [],
    });

    expect(result).toEqual(['Login funciona']);
  });
});
