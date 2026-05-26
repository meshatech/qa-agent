import { describe, expect, it, vi } from 'vitest';

import { RunPipelinePreflightUseCase } from '../src/application/use-cases/run-pipeline-preflight.usecase.js';
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
  },
};

describe('RunPipelinePreflightUseCase', () => {
  it('delegates to PipelinePreflightService.runOrThrow and returns reportPath', async () => {
    const runResult = { report: passReport, reportPath: '/tmp/pipeline/preflight-report.json' };
    const runOrThrow = vi.fn().mockResolvedValue(runResult);
    const useCase = new RunPipelinePreflightUseCase({ runOrThrow } as never);

    const result = await useCase.execute('/tmp/pipeline');

    expect(runOrThrow).toHaveBeenCalledWith('/tmp/pipeline');
    expect(result.report.status).toBe('PASS');
    expect(result.reportPath).toContain('preflight-report.json');
  });

  it('propagates PreflightBlockedError from the service', async () => {
    const blockedReport = { ...passReport, status: 'BLOCKED' as const };
    const runOrThrow = vi.fn().mockRejectedValue(new PreflightBlockedError(blockedReport, '/tmp/pipeline/preflight-report.json'));
    const useCase = new RunPipelinePreflightUseCase({ runOrThrow } as never);

    await expect(useCase.execute('/tmp/pipeline')).rejects.toBeInstanceOf(PreflightBlockedError);
  });
});
