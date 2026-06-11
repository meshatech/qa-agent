import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunPipelineAllUseCase } from '../src/application/use-cases/run-pipeline-all.usecase.js';
import { CorrelationBlockedError, PreflightBlockedError } from '../src/domain/errors.js';
import { createBlockedCorrelationResult } from '../src/domain/schemas/correlation.schema.js';
import { PREFLIGHT_CHECK_NAMES } from '../src/domain/schemas/preflight-report.schema.js';
import { ExitCodes } from '../src/interfaces/cli/exit-codes.js';
import { clearCiInjectedEnv } from './helpers/ci-env-isolation.js';

const passReport = {
  schemaVersion: 'preflight-report.v1' as const,
  status: 'PASS' as const,
  timestamp: new Date().toISOString(),
  tokensMasked: true as const,
  checkItems: PREFLIGHT_CHECK_NAMES.map((name) => ({
    name,
    status: 'PASS' as const,
    message: `${name} ok`,
  })),
  checks: {
    clickupToken: { ok: true },
    clickupReadAccess: { ok: true },
    clickupTaskId: { ok: true },
    githubToken: { ok: true },
    prCommentPermission: { ok: true },
    prContext: { ok: true, missing: [] },
    branchHead: { ok: true, branchHead: 'feature/test', missing: [] },
    checkoutHistory: { ok: true, errors: [] },
    config: { ok: true, errors: [] },
  },
};

const okCorrelation = {
  result: {
    schemaVersion: 'correlation-result.v1' as const,
    status: 'OK' as const,
    scenarios: [],
    correlations: [],
    risks: [],
    warnings: [],
  },
};

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  clearCiInjectedEnv();
});

afterEach(() => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
});

function makeUseCase(overrides: {
  prepare?: { execute: ReturnType<typeof vi.fn> };
  correlate?: { execute: ReturnType<typeof vi.fn> };
  risk?: { execute: ReturnType<typeof vi.fn> };
  generatePlan?: { execute: ReturnType<typeof vi.fn> };
  execute?: { execute: ReturnType<typeof vi.fn> };
  report?: { execute: ReturnType<typeof vi.fn> };
  learning?: { execute: ReturnType<typeof vi.fn> };
  promoteLearning?: { execute: ReturnType<typeof vi.fn> };
  githubComment?: { postComment: ReturnType<typeof vi.fn> };
  githubEventContext?: { resolvePullNumber: ReturnType<typeof vi.fn> };
}) {
  const prepareExecute = overrides.prepare?.execute ?? vi.fn().mockResolvedValue({
    preflightReport: passReport,
    preflightReportPath: '/tmp/pipeline/preflight-report.json',
    prDiffContext: {},
    prDiffContextPath: '/tmp/pipeline/pr-diff-context.json',
    tokensMasked: true,
  });
  const correlateExecute = overrides.correlate?.execute ?? vi.fn().mockResolvedValue(okCorrelation);
  const riskExecute = overrides.risk?.execute ?? vi.fn().mockResolvedValue({
    riskScorePath: '/tmp/pipeline/risk-score.json',
    value: 0.3,
    level: 'LOW',
    factorCount: 2,
    explanation: 'Low risk',
  });
  const generatePlanExecute = overrides.generatePlan?.execute ?? vi.fn().mockResolvedValue({
    executionPlanPath: '/tmp/pipeline/execution-plan.json',
    qualityAudit: {
      semanticTargetsPerTask: 0,
      hasFragileTargets: false,
      hasGenericTargets: false,
      hasUnobservableTargets: false,
    },
    warnings: [],
  });
  const executeExecute = overrides.execute?.execute ?? vi.fn().mockResolvedValue({
    ok: true,
    stepsExecuted: 1,
    stepsPassed: 1,
    stepsFailed: 0,
    warningsCount: 0,
    locatorTelemetry: [],
    telemetrySummary: {
      deterministicResolutions: 0,
      semanticFallbacks: 0,
      llmDecides: 0,
      replans: 0,
      targetsNotFound: 0,
    },
  });
  const reportExecute = overrides.report?.execute ?? vi.fn().mockResolvedValue({
    reportPath: '/tmp/pipeline/pipeline-report.md',
    pipelineStatus: 'COMPLETED',
    sectionsGenerated: ['Header'],
  });
  const learningExecute = overrides.learning?.execute ?? vi.fn().mockResolvedValue({
    candidatesPath: '/tmp/pipeline/learning-candidates.json',
    count: 0,
    confirmedCount: 0,
    inferredCount: 0,
    gapCount: 0,
    semanticLocatorSuggestions: 0,
    hasEphemeralIdsFiltered: false,
  });
  const promoteExecute = overrides.promoteLearning?.execute ?? vi.fn().mockResolvedValue({
    promotedPath: '/tmp/pipeline/promoted.json',
    promotedCount: 0,
    rejectedCount: 0,
    promotionLogPath: '/tmp/pipeline/promotion-log.json',
    warnings: [],
  });
  const postComment = overrides.githubComment?.postComment ?? vi.fn().mockResolvedValue(undefined);
  const resolvePullNumber = overrides.githubEventContext?.resolvePullNumber ?? vi.fn().mockResolvedValue(42);

  const useCase = new RunPipelineAllUseCase(
    { execute: prepareExecute } as never,
    { execute: correlateExecute } as never,
    { execute: riskExecute } as never,
    { execute: generatePlanExecute } as never,
    { execute: executeExecute } as never,
    { execute: reportExecute } as never,
    { execute: learningExecute } as never,
    { execute: promoteExecute } as never,
    { postComment } as never,
    { resolvePullNumber } as never,
  );

  return {
    useCase,
    prepareExecute,
    correlateExecute,
    riskExecute,
    generatePlanExecute,
    executeExecute,
    reportExecute,
    learningExecute,
    promoteExecute,
    postComment,
    resolvePullNumber,
  };
}

describe('RunPipelineAllUseCase', () => {
  it('runs full happy path with OK exit code', async () => {
    const { useCase, postComment } = makeUseCase({});

    const result = await useCase.execute('/tmp/pipeline', { configPath: './agent-qa.config.json' });

    expect(result.exitCode).toBe(ExitCodes.OK);
    expect(result.steps).toHaveLength(8);
    expect(result.steps.every((step) => step.status === 'OK')).toBe(true);
    expect(result.blockedAt).toBeUndefined();
    expect(result.commentPosted).toBeUndefined();
    expect(postComment).not.toHaveBeenCalled();
  });

  it('stops after prepare BLOCKED and posts specific preflight reason', async () => {
    const blockedReport = {
      ...passReport,
      status: 'BLOCKED' as const,
      checkItems: passReport.checkItems.map((item) =>
        item.name === 'clickupToken'
          ? { ...item, status: 'FAIL' as const, message: 'CLICKUP_TOKEN is missing' }
          : item,
      ),
      checks: { ...passReport.checks, clickupToken: { ok: false } },
    };
    const prepareExecute = vi.fn().mockRejectedValue(
      new PreflightBlockedError(blockedReport, '/tmp/pipeline/preflight-report.json'),
    );
    const correlateExecute = vi.fn();
    const generatePlanExecute = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);

    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_REF = 'refs/pull/42/merge';

    const { useCase } = makeUseCase({
      prepare: { execute: prepareExecute },
      correlate: { execute: correlateExecute },
      generatePlan: { execute: generatePlanExecute },
      githubComment: { postComment },
    });

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.exitCode).toBe(ExitCodes.PREFLIGHT_BLOCKED);
    expect(result.blockedAt).toBe('prepare');
    expect(result.commentPosted).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.name).toBe('prepare');
    expect(result.steps[0]?.status).toBe('BLOCKED');
    expect(postComment).toHaveBeenCalledWith({
      repository: 'owner/repo',
      pullNumber: 42,
      body: 'QA bloqueado: CLICKUP_TOKEN is missing',
      token: 'ghp_test',
    });
    expect(correlateExecute).not.toHaveBeenCalled();
    expect(generatePlanExecute).not.toHaveBeenCalled();
  });

  it('stops after correlate BLOCKED with sanitized reason comment', async () => {
    const blocked = createBlockedCorrelationResult('acceptanceCriteria is empty');
    const correlateExecute = vi.fn().mockRejectedValue(new CorrelationBlockedError(blocked));
    const generatePlanExecute = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);

    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_REF = 'refs/pull/7/merge';

    const { useCase } = makeUseCase({
      correlate: { execute: correlateExecute },
      generatePlan: { execute: generatePlanExecute },
      githubComment: { postComment },
    });

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.exitCode).toBe(ExitCodes.PREFLIGHT_BLOCKED);
    expect(result.blockedAt).toBe('correlate');
    expect(result.commentPosted).toBe(true);
    expect(postComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'acceptanceCriteria is empty',
      }),
    );
    expect(generatePlanExecute).not.toHaveBeenCalled();
  });

  it('returns BUGS_FOUND when execute fails but still runs learning and promote', async () => {
    const executeExecute = vi.fn().mockResolvedValue({
      ok: false,
      stepsExecuted: 2,
      stepsPassed: 1,
      stepsFailed: 1,
      warningsCount: 0,
      locatorTelemetry: [],
      telemetrySummary: {
        deterministicResolutions: 0,
        semanticFallbacks: 0,
        llmDecides: 0,
        replans: 0,
        targetsNotFound: 0,
      },
      failedMessage: 'step failed',
    });
    const learningExecute = vi.fn().mockResolvedValue({
      candidatesPath: '/tmp/pipeline/learning-candidates.json',
      count: 0,
      confirmedCount: 0,
      inferredCount: 0,
      gapCount: 0,
      semanticLocatorSuggestions: 0,
      hasEphemeralIdsFiltered: false,
    });
    const promoteExecute = vi.fn().mockResolvedValue({
      promotedPath: '/tmp/pipeline/promoted.json',
      promotedCount: 0,
      rejectedCount: 0,
      promotionLogPath: '/tmp/pipeline/promotion-log.json',
      warnings: [],
    });

    const { useCase } = makeUseCase({
      execute: { execute: executeExecute },
      learning: { execute: learningExecute },
      promoteLearning: { execute: promoteExecute },
    });

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.exitCode).toBe(ExitCodes.BUGS_FOUND);
    expect(result.steps.find((s) => s.name === 'execute')?.status).toBe('BUGS_FOUND');
    expect(learningExecute).toHaveBeenCalled();
    expect(promoteExecute).toHaveBeenCalled();
  });

  it('treats learning and promote-learning zero-count as OK', async () => {
    const { useCase } = makeUseCase({});

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.steps.find((s) => s.name === 'learning')?.exitCode).toBe(ExitCodes.OK);
    expect(result.steps.find((s) => s.name === 'promote-learning')?.exitCode).toBe(ExitCodes.OK);
    expect(result.exitCode).toBe(ExitCodes.OK);
  });

  it('aggregates most severe exit when execute has bugs and generate-plan has config error', async () => {
    const generatePlanExecute = vi.fn().mockResolvedValue({
      executionPlanPath: undefined,
      qualityAudit: {
        semanticTargetsPerTask: 0,
        hasFragileTargets: false,
        hasGenericTargets: false,
        hasUnobservableTargets: false,
      },
      warnings: [],
    });
    const executeExecute = vi.fn().mockResolvedValue({
      ok: false,
      stepsExecuted: 1,
      stepsPassed: 0,
      stepsFailed: 1,
      warningsCount: 0,
      locatorTelemetry: [],
      telemetrySummary: {
        deterministicResolutions: 0,
        semanticFallbacks: 0,
        llmDecides: 0,
        replans: 0,
        targetsNotFound: 0,
      },
    });

    const { useCase } = makeUseCase({
      generatePlan: { execute: generatePlanExecute },
      execute: { execute: executeExecute },
    });

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.exitCode).toBe(ExitCodes.BUGS_FOUND);
  });

  it('does not post comment when token or PR context is missing on BLOCKED', async () => {
    const blockedReport = { ...passReport, status: 'BLOCKED' as const };
    const prepareExecute = vi.fn().mockRejectedValue(
      new PreflightBlockedError(blockedReport, '/tmp/pipeline/preflight-report.json'),
    );
    const postComment = vi.fn();

    const { useCase } = makeUseCase({
      prepare: { execute: prepareExecute },
      githubComment: { postComment },
      githubEventContext: { resolvePullNumber: vi.fn().mockResolvedValue(undefined) },
    });

    const result = await useCase.execute('/tmp/pipeline');

    expect(result.exitCode).toBe(ExitCodes.PREFLIGHT_BLOCKED);
    expect(result.commentPosted).toBe(false);
    expect(postComment).not.toHaveBeenCalled();
  });
});
