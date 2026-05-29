import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RiskClassifierService } from '../src/application/services/risk-classifier.service.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';
import type { RunHistoryEntry } from '../src/application/services/run-history.service.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';

const createMockRepository = (): RunRepositoryPort =>
  ({
    writeJson: vi.fn().mockResolvedValue(undefined),
    createRunDir: vi.fn(),
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    writeReport: vi.fn(),
    findRunDir: vi.fn(),
    readJson: vi.fn(),
    exists: vi.fn(),
    listFiles: vi.fn(),
    appendRunHistory: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunRepositoryPort);

describe('RiskClassifierService', () => {
  const mockRepository = createMockRepository();
  const service = new RiskClassifierService(mockRepository);

  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(score.factors).toHaveLength(9);
    expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
  });

  it('increases risk for route changes', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
        { path: 'src/routes/order.ts', status: 'modified', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const routeFactor = score.factors.find((f) => f.name === 'route_change');
    expect(routeFactor!.contribution).toBeGreaterThan(0);
    expect(score.level).toBe('medium');
  });

  it('applies higher multiplier for added files', () => {
    const modifiedContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const addedContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'added', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [], contextLines: [] },
      ],
    });
    const modifiedScore = service.classify(modifiedContext, []);
    const addedScore = service.classify(addedContext, []);
    const modifiedRoute = modifiedScore.factors.find((f) => f.name === 'route_change')!;
    const addedRoute = addedScore.factors.find((f) => f.name === 'route_change')!;
    expect(addedRoute.contribution).toBeGreaterThan(modifiedRoute.contribution);
  });

  it('applies highest multiplier for removed files', () => {
    const modifiedContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const removedContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'removed', kind: 'route', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
      ],
    });
    const modifiedScore = service.classify(modifiedContext, []);
    const removedScore = service.classify(removedContext, []);
    const modifiedRoute = modifiedScore.factors.find((f) => f.name === 'route_change')!;
    const removedRoute = removedScore.factors.find((f) => f.name === 'route_change')!;
    expect(removedRoute.contribution).toBeGreaterThan(modifiedRoute.contribution);
  });

  it('increases risk for schema changes', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/schema/user.ts', status: 'modified', kind: 'schema', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const schemaFactor = score.factors.find((f) => f.name === 'schema_change');
    expect(schemaFactor!.contribution).toBeGreaterThan(0);
  });

  it('increases risk for test removal', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'test/user.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }, { type: 'removed' as const, lineNumber: 3, content: 'removed line' }, { type: 'removed' as const, lineNumber: 4, content: 'removed line' }], contextLines: [] },
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
        { path: 'infra/db.ts', status: 'modified', kind: 'infra', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const infraFactor = score.factors.find((f) => f.name === 'infra_change');
    expect(infraFactor!.contribution).toBeGreaterThan(0);
  });

  it('considers docs changes with low weight', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'docs/api.md', status: 'modified', kind: 'docs', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const docsFactor = score.factors.find((f) => f.name === 'docs_change');
    expect(docsFactor!.contribution).toBeGreaterThan(0);
    expect(docsFactor!.weight).toBe(0.03);
  });

  it('considers other file changes with minimal weight', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'README.md', status: 'modified', kind: 'other', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const otherFactor = score.factors.find((f) => f.name === 'other_change');
    expect(otherFactor!.contribution).toBeGreaterThan(0);
    expect(otherFactor!.weight).toBe(0.02);
  });

  it('returns zero contribution when no diff lines', () => {
    const score = service.classify(makePrContext(), []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBe(0);
  });

  it('returns zero contribution for low negative diff ratio', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/app.ts', status: 'modified', kind: 'other', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'a' }, { type: 'added' as const, lineNumber: 2, content: 'b' }, { type: 'added' as const, lineNumber: 3, content: 'c' }, { type: 'added' as const, lineNumber: 4, content: 'd' }], negativeLines: [{ type: 'removed' as const, lineNumber: 5, content: 'r' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBe(0);
  });

  it('increases risk for medium negative diff ratio', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/app.ts', status: 'modified', kind: 'other', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'a' }, { type: 'added' as const, lineNumber: 2, content: 'b' }, { type: 'added' as const, lineNumber: 3, content: 'c' }], negativeLines: [{ type: 'removed' as const, lineNumber: 4, content: 'r' }, { type: 'removed' as const, lineNumber: 5, content: 'r' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBeGreaterThan(0);
    expect(diffFactor!.contribution).toBeLessThan(0.1);
  });

  it('reaches max weight for 100% negative diff', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/app.ts', status: 'modified', kind: 'other', positiveLines: [], negativeLines: [{ type: 'removed' as const, lineNumber: 1, content: 'r' }, { type: 'removed' as const, lineNumber: 2, content: 'r' }, { type: 'removed' as const, lineNumber: 3, content: 'r' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBe(0.1);
  });

  it('caps negative diff contribution at max weight', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/app.ts', status: 'modified', kind: 'other', positiveLines: [], negativeLines: Array.from({ length: 100 }, (_, i) => ({ type: 'removed' as const, lineNumber: i + 1, content: 'r' })), contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    const diffFactor = score.factors.find((f) => f.name === 'negative_diff_ratio');
    expect(diffFactor!.contribution).toBe(0.1);
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
        { path: 'src/routes/user.ts', status: 'removed', kind: 'route', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'src/routes/order.ts', status: 'removed', kind: 'route', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'src/routes/payment.ts', status: 'removed', kind: 'route', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'src/schema/user.ts', status: 'removed', kind: 'schema', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'src/schema/order.ts', status: 'removed', kind: 'schema', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'test/user.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }, { type: 'removed' as const, lineNumber: 3, content: 'removed line' }, { type: 'removed' as const, lineNumber: 4, content: 'removed line' }], contextLines: [] },
        { path: 'test/order.spec.ts', status: 'modified', kind: 'test', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }, { type: 'removed' as const, lineNumber: 3, content: 'removed line' }], contextLines: [] },
        { path: 'infra/db.ts', status: 'removed', kind: 'infra', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
        { path: 'infra/ci.ts', status: 'removed', kind: 'infra', positiveLines: [], negativeLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }], contextLines: [] },
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

  it('returns zero affected_route_failure when no history', () => {
    const prContext = makePrContext({
      affectedRoutes: ['/users'],
      affectedSchemas: ['user-schema'],
    });
    const score = service.classify(prContext, []);
    const factor = score.factors.find((f) => f.name === 'affected_route_failure');
    expect(factor!.contribution).toBe(0);
  });

  it('returns zero affected_route_failure when no failures', () => {
    const history = makeRunHistory([
      { status: 'passed' }, { status: 'passed' }, { status: 'passed' },
    ]);
    const prContext = makePrContext({
      affectedRoutes: ['/users'],
    });
    const score = service.classify(prContext, history);
    const factor = score.factors.find((f) => f.name === 'affected_route_failure');
    expect(factor!.contribution).toBe(0);
  });

  it('returns zero affected_route_failure when no affected routes', () => {
    const history = makeRunHistory([
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
    ]);
    const score = service.classify(makePrContext(), history);
    const factor = score.factors.find((f) => f.name === 'affected_route_failure');
    expect(factor!.contribution).toBe(0);
  });

  it('increases risk for failures with affected routes', () => {
    const history = makeRunHistory([
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
      { status: 'failed' }, { status: 'failed' }, { status: 'passed' },
    ]);
    const prContext = makePrContext({
      affectedRoutes: ['/users', '/orders', '/payments'],
      affectedSchemas: ['user-schema'],
    });
    const score = service.classify(prContext, history);
    const factor = score.factors.find((f) => f.name === 'affected_route_failure');
    expect(factor!.contribution).toBeGreaterThan(0);
    expect(factor!.contribution).toBeLessThanOrEqual(0.08);
  });

  it('caps affected_route_failure at max weight', () => {
    const history = makeRunHistory([
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
    ]);
    const prContext = makePrContext({
      affectedRoutes: Array.from({ length: 20 }, (_, i) => `/route-${i}`),
      affectedSchemas: Array.from({ length: 20 }, (_, i) => `schema-${i}`),
    });
    const score = service.classify(prContext, history);
    const factor = score.factors.find((f) => f.name === 'affected_route_failure');
    expect(factor!.contribution).toBe(0.08);
  });

  it('caps risk value at 1.0', () => {
    const prContext = makePrContext({
      changedFiles: Array.from({ length: 20 }, (_, i) => ({
        path: `src/routes/${i}.ts`,
        status: 'modified' as const,
        kind: 'route' as const,
        positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'added line' }],
        negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'removed line' }],
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

  it('generates explanation with score and level', () => {
    const score = service.classify(makePrContext(), []);
    expect(score.explanation).toContain(`Risk score: ${score.value.toFixed(2)}`);
    expect(score.explanation).toContain(score.level.toUpperCase());
    expect(score.explanation).toContain('Calculated at:');
    expect(score.explanation).toContain('Factors considered:');
  });

  it('generates explanation listing active factors', () => {
    const prContext = makePrContext({
      changedFiles: [
        { path: 'src/routes/user.ts', status: 'modified', kind: 'route', positiveLines: [{ type: 'added' as const, lineNumber: 1, content: 'a' }], negativeLines: [{ type: 'removed' as const, lineNumber: 2, content: 'r' }], contextLines: [] },
      ],
    });
    const score = service.classify(prContext, []);
    expect(score.explanation).toContain('route_change');
    expect(score.explanation).toContain('contribution');
  });

  it('generates explanation with no factors when risk is zero', () => {
    const score = service.classify(makePrContext(), []);
    expect(score.explanation).toContain('No risk factors detected');
  });

  it('saves risk score to risk-score.json', async () => {
    const score = service.classify(makePrContext(), []);
    await service.save('/tmp/run-001', score);
    expect(mockRepository.writeJson).toHaveBeenCalledOnce();
    const callArgs = (mockRepository.writeJson as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('/tmp/run-001');
    expect(callArgs[1]).toBe('risk-score.json');
    expect(callArgs[2]).toEqual(score);
  });

  it('rejects negative scores', () => {
    const prContext = makePrContext();
    const score = service.classify(prContext, []);
    expect(score.value).toBeGreaterThanOrEqual(0);
  });
});
