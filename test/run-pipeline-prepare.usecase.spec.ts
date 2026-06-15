import { describe, expect, it, vi } from 'vitest';

import { RunPipelinePrepareUseCase } from '../src/application/use-cases/run-pipeline-prepare.usecase.js';
import { PreflightBlockedError } from '../src/domain/errors.js';
import { PREFLIGHT_CHECK_NAMES } from '../src/domain/schemas/preflight-report.schema.js';

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
    previewReachable: { ok: true, statusCode: 200, url: 'http://127.0.0.1:4173' },
  },
};

const prDiffContext = {
  schemaVersion: 'pr-diff-context.v1' as const,
  pullRequest: {
    prNumber: 42,
    baseBranch: 'main',
    headBranch: 'feature/test',
    title: 'PRJ-11552 — Fix login',
    author: 'octocat',
    clickUpTaskId: 'PRJ-11552',
  },
  changedFiles: [],
  affectedRoutes: [],
  affectedSchemas: [],
};

describe('RunPipelinePrepareUseCase', () => {
  it('runs preflight before read-pr-context and returns combined result', async () => {
    const preflightExecute = vi.fn().mockResolvedValue({
      report: passReport,
      reportPath: '/tmp/pipeline/preflight-report.json',
    });
    const readPrContextExecute = vi.fn().mockResolvedValue({
      context: prDiffContext,
      contextPath: '/tmp/pipeline/pr-diff-context.json',
      tokensMasked: true,
    });
    const useCase = new RunPipelinePrepareUseCase(
      { execute: preflightExecute } as never,
      { execute: readPrContextExecute } as never,
    );

    const result = await useCase.execute('/tmp/pipeline');

    expect(preflightExecute).toHaveBeenCalledWith('/tmp/pipeline');
    expect(readPrContextExecute).toHaveBeenCalledWith('/tmp/pipeline');
    expect(preflightExecute.mock.invocationCallOrder[0]).toBeLessThan(
      readPrContextExecute.mock.invocationCallOrder[0]!,
    );
    expect(result.preflightReport.status).toBe('PASS');
    expect(result.preflightReportPath).toContain('preflight-report.json');
    expect(result.prDiffContextPath).toContain('pr-diff-context.json');
    expect(result.tokensMasked).toBe(true);
  });

  it('does not call read-pr-context when preflight is BLOCKED', async () => {
    const blockedReport = { ...passReport, status: 'BLOCKED' as const };
    const preflightExecute = vi.fn().mockRejectedValue(
      new PreflightBlockedError(blockedReport, '/tmp/pipeline/preflight-report.json'),
    );
    const readPrContextExecute = vi.fn();
    const useCase = new RunPipelinePrepareUseCase(
      { execute: preflightExecute } as never,
      { execute: readPrContextExecute } as never,
    );

    await expect(useCase.execute('/tmp/pipeline')).rejects.toBeInstanceOf(PreflightBlockedError);
    expect(readPrContextExecute).not.toHaveBeenCalled();
  });
});
