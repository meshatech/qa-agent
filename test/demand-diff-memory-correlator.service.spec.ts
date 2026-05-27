import { describe, expect, it } from 'vitest';

import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { correlateCriterionWithDiff } from '../src/domain/helpers/criterion-diff-correlator.js';
import { truncate } from '../src/domain/helpers/correlation-lexical.js';
import { consumeMemorySearchResults } from '../src/domain/helpers/memory-search-consumer.js';
import { consumePrDiffContext } from '../src/domain/helpers/pr-diff-context-consumer.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11392',
  title: 'Login improvements',
  description: 'Improve login',
  acceptanceCriteria: [
    'Login route validates user credentials',
    'Invalid login shows error message',
  ],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

const BASE_PR_DIFF: PrDiffContext = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature/login',
    title: 'PRJ-11392 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11392',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [{ type: 'added', lineNumber: 1, content: 'validate credentials' }],
      negativeLines: [{ type: 'removed', lineNumber: 2, content: 'legacy auth' }],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/login'],
  affectedSchemas: [],
};

describe('DemandDiffMemoryCorrelatorService', () => {
  const service = new DemandDiffMemoryCorrelatorService();

  it('correlates acceptance criteria with changed login route files', () => {
    const result = service.correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('OK');
    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(result.correlations.some((item) => item.file?.includes('login'))).toBe(true);
    expect(result.risks.some((risk) => risk.type === 'regression')).toBe(true);
  });

  it('returns OK with warning when memory is empty', () => {
    const result = service.correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('OK');
    expect(result.warnings.some((warning) => warning.includes('BM25 memory'))).toBe(true);
  });

  it('returns BLOCKED when acceptance criteria is empty', () => {
    const result = service.correlate({
      demand: { ...BASE_DEMAND, acceptanceCriteria: [] },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('acceptanceCriteria');
    expect(result.scenarios).toEqual([]);
  });

  it('returns BLOCKED when diff has no changed files or affected signals', () => {
    const result = service.correlate({
      demand: BASE_DEMAND,
      prDiff: {
        ...BASE_PR_DIFF,
        changedFiles: [],
        affectedRoutes: [],
        affectedSchemas: [],
      },
      memoryResults: [],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('changedFiles');
  });

  it('flags uncovered criteria without related files', () => {
    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria: ['Billing invoice export supports CSV format'],
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.risks.some((risk) => risk.type === 'uncovered_criterion')).toBe(true);
  });

  it('flags demand_diff_mismatch when demand topic does not match diff', () => {
    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        title: 'Billing export improvements',
        description: 'Invoice billing dashboard export',
        acceptanceCriteria: ['Billing invoice export supports CSV format'],
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.risks.some((risk) => risk.type === 'demand_diff_mismatch')).toBe(true);
  });

  it('returns BLOCKED when demand context schema is invalid', () => {
    const result = service.correlate({
      demand: { taskId: '' } as DemandContext,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('Invalid demand context schema');
  });

  it('returns BLOCKED when PR diff context schema is invalid', () => {
    const result = service.correlate({
      demand: BASE_DEMAND,
      prDiff: { ...BASE_PR_DIFF, schemaVersion: 'wrong-version' } as unknown as PrDiffContext,
      memoryResults: [],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('Invalid PR diff context schema');
  });

  it('returns BLOCKED when memory search results schema is invalid', () => {
    const result = service.correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [{ chunk: { id: 'bad' } }] as never,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('Invalid memory search results schema');
  });

  it('returns BLOCKED when route fallback cannot derive scenarios without changed files', () => {
    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria: ['Billing invoice export supports CSV format'],
      },
      prDiff: {
        ...BASE_PR_DIFF,
        changedFiles: [],
        affectedRoutes: ['/billing'],
        affectedSchemas: [],
      },
      memoryResults: [],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toContain('No required scenarios could be derived');
    expect(result.scenarios).toEqual([]);
  });

  it('adds warning when some criteria pass and others stay below threshold', () => {
    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria: [
          'Login route validates user credentials',
          'Invalid login shows error message',
          'Billing invoice export supports CSV format',
          'Billing dashboard reconciles monthly statements',
          'Billing payment retry handles declined cards',
        ],
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('OK');
    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(
      result.warnings.some(
        (warning) =>
          !warning.includes('scenarios derived from affected routes only') &&
          warning.includes('Criteria below correlation threshold') &&
          warning.includes('Billing invoice export supports CSV format'),
      ),
    ).toBe(true);
  });

  it('adds warning when route fallback scenarios are used', () => {
    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria: ['Billing invoice export supports CSV format'],
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('OK');
    expect(result.scenarios.some((scenario) => scenario.title.includes('/login'))).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes('scenarios derived from affected routes only'),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes('Criteria below correlation threshold') &&
          warning.includes('Billing invoice export supports CSV format'),
      ),
    ).toBe(true);
  });

  it('caps scenarios at MAX_SCENARIOS and warns when criteria exceed the limit', () => {
    const criteria = Array.from({ length: 12 }, (_, index) =>
      `Login route validates user credentials check ${String(index + 1).padStart(2, '0')}`,
    );

    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria: criteria,
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    expect(result.status).toBe('OK');
    expect(result.scenarios).toHaveLength(10);
    expect(
      result.warnings.some((warning) => warning.includes('Scenario cap reached (10)')),
    ).toBe(true);
  });

  it('prefers higher-scoring criteria when scenario cap is reached', () => {
    const weakCriteria = Array.from({ length: 10 }, (_, index) =>
      `Alpha beta gamma delta login check ${String(index + 1).padStart(2, '0')}`,
    );
    const strongCriteria = [
      'Login route credentials check eleven',
      'Login route credentials check twelve',
    ];
    const acceptanceCriteria = [...weakCriteria, ...strongCriteria];

    const prDiff = consumePrDiffContext(BASE_PR_DIFF);
    const memory = consumeMemorySearchResults([]);
    const scored = acceptanceCriteria.map((criterion) => ({
      criterion,
      score: correlateCriterionWithDiff({ criterion, prDiff, memory }).correlation.score,
    }));
    const passing = scored.filter((entry) => entry.score >= 0.15);
    const topTwo = [...passing]
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((entry) => entry.criterion);

    expect(passing.length).toBeGreaterThan(10);
    expect(topTwo).toEqual(
      expect.arrayContaining([
        'Login route credentials check eleven',
        'Login route credentials check twelve',
      ]),
    );

    const result = service.correlate({
      demand: {
        ...BASE_DEMAND,
        acceptanceCriteria,
      },
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    const scenarioTitles = result.scenarios.map((scenario) => scenario.title);

    expect(result.status).toBe('OK');
    expect(result.scenarios).toHaveLength(10);
    expect(scenarioTitles).toContain(truncate(strongCriteria[0]!, 100));
    expect(scenarioTitles).toContain(truncate(strongCriteria[1]!, 100));
    expect(scenarioTitles).not.toContain(truncate(weakCriteria[9]!, 100));
    expect(
      result.warnings.some((warning) => warning.includes('Scenario cap reached (10)')),
    ).toBe(true);
  });
});
