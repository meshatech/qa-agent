import { describe, expect, it } from 'vitest';

import { RiskClassifierService } from '../src/application/services/risk-classifier.service.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';
import type { RunHistoryEntry } from '../src/application/services/run-history.service.js';

describe('RiskClassifierService', () => {
  const service = new RiskClassifierService();

  const makePrContext = (overrides: Partial<PrDiffContext> = {}): PrDiffContext =>
    ({
      schemaVersion: 'pr-diff-context.v1',
      pullRequest: {
        prNumber: 1,
        baseBranch: 'main',
        headBranch: 'feature',
        title: 'Test PR',
        author: 'test',
      },
      changedFiles: [],
      affectedRoutes: [],
      affectedSchemas: [],
      ...overrides,
    } as PrDiffContext);

  const makeRunHistory = (entries: Array<{ status: string }> = []): RunHistoryEntry[] =>
    entries.map((e, i) => ({
      runId: `run-${i}`,
      ts: '2024-05-29T10:00:00Z',
      status: e.status,
    }));

  it('returns low risk for empty PR and no history', () => {
    const score = service.classify(makePrContext(), []);
    expect(score.level).toBe('low');
    expect(score.value).toBe(0);
    expect(score.factors).toHaveLength(6);
    expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
  });

  it('increases risk for route changes', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'src/routes/order.ts', status: 'modified', kind: 'route', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const routeFactor = score.factors.find((f) => f.name === 'route_change');
    expect(routeFactor!.contribution).toBeGreaterThan(0);
    expect(score.level).toBe('medium');
  });

  it('increases risk for schema changes', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/schema/user.ts', status: 'modified', kind: 'schema', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const schemaFactor = score.factors.find((f) => f.name === 'schema_change');
    expect(schemaFactor!.contribution).toBeGreaterThan(0);
  });

  it('increases risk for test removal', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'test/user.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }, { line: 3 }, { line: 4 }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const testFactor = score.factors.find((f) => f.name === 'test_removal');
    expect(testFactor!.contribution).toBeGreaterThan(0);
    expect(testFactor!.contribution).toBe(0.2);
  });

  it('increases risk for infra changes', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'infra/db.ts', status: 'modified', kind: 'infra', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const infraFactor = score.factors.find((f) => f.name === 'infra_change');
    expect(infraFactor!.contribution).toBeGreaterThan(0);
  });

  it('increases risk for high negative diff ratio', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/app.ts', status: 'modified', kind: 'other', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }, { line: 3 }, { line: 4 }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBeGreaterThan(0);
  });

  it('increases risk for failure history', () => {
    const history = makeRunHistory([
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
      { status: 'passed' }, { status: 'passed' }, { status: 'passed' },
      { status: 'passed' }, { status: 'passed' }, { status: 'passed' },
      { status: 'passed' },
    ]);
    const score = service.classify(makePrContext(), history);
    const historyFactor = score.factors.find((f) => f.name === 'failure_history');
    expect(historyFactor!.contribution).toBeGreaterThan(0);
  });

  it('returns critical risk for multiple high-risk factors', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }, { line: 3 }], contextLines: [] },
        { path: 'src/routes/order.ts', status: 'modified', kind: 'route', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'src/routes/payment.ts', status: 'modified', kind: 'route', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'src/schema/user.ts', status: 'modified', kind: 'schema', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'src/schema/order.ts', status: 'modified', kind: 'schema', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'test/user.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }, { line: 3 }, { line: 4 }], contextLines: [] },
        { path: 'test/order.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }, { line: 3 }], contextLines: [] },
        { path: 'infra/db.ts', status: 'modified', kind: 'infra', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
        { path: 'infra/ci.ts', status: 'modified', kind: 'infra', positiveLines: [{ line: 1 }], negativeLines: [{ line: 2 }], contextLines: [] },
      ],
    });
    const history = makeRunHistory([
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
    ]);
    const score = service.classify(prContext, history);
    expect(score.value).toBeGreaterThanOrEqual(0.75);
    expect(score.level).toBe('critical');
  });

  it('caps risk value at 1.0', () => {
    const prContext = makePrContext({
      changedFiles: Array.from({ length: 20 }, (_, i) => ({
        path: `src/routes/${i}.ts`,
        status: 'modified' as const,
        kind: 'route' as const,
        positiveLines: [{ line: 1 }],
        negativeLines: [{ line: 2 }],
        contextLines: [],
      })),
    });
    const score = service.classify(prContext, []);
    expect(score.value).toBeLessThanOrEqual(1.0);
  });

  it('sets calculatedAt timestamp', () => {
    const before = new Date().toISOString();
    const score = service.classify(makePrContext(), []);
    const after = new Date().toISOString();
    expect(score.calculatedAt >= before && score.calculatedAt <= after).toBe(true);
  });
});
