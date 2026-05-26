import { describe, expect, it } from 'vitest';
import { ExitCodes, classifyError, classifyPreflightReport, classifyResult } from '../src/interfaces/cli/exit-codes.js';
import { ConfigError, HarnessFatalError, PreflightBlockedError, RunTimeoutError } from '../src/domain/errors.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';
import { PREFLIGHT_CHECK_NAMES } from '../src/domain/schemas/preflight-report.schema.js';

const baseResult: QaRunResult = {
  status: 'PASSED',
  runDir: '/tmp/run',
  steps: [],
  bugs: [],
};

describe('CLI exit codes', () => {
  it('0 OK when run passed without high/critical bugs', () => {
    expect(classifyResult(baseResult)).toBe(ExitCodes.OK);
  });

  it('1 BUGS_FOUND when CRITICAL bug', () => {
    const result: QaRunResult = {
      ...baseResult,
      status: 'BLOCKED',
      bugs: [{ bugId: 'B', stepId: 'S', classification: { isBug: true, severity: 'CRITICAL', category: 'APP_FAULT', reason: 'x' }, path: 'b', capturedAt: '' }],
    };
    expect(classifyResult(result)).toBe(ExitCodes.BUGS_FOUND);
  });

  it('1 BUGS_FOUND when status is FAILED even without bugs', () => {
    expect(classifyResult({ ...baseResult, status: 'FAILED' })).toBe(ExitCodes.BUGS_FOUND);
  });

  it('2 CONFIG_ERROR for ConfigError', () => {
    expect(classifyError(new ConfigError('bad config'))).toBe(ExitCodes.CONFIG_ERROR);
  });

  it('3 HARNESS_FATAL for HarnessFatalError', () => {
    expect(classifyError(new HarnessFatalError('browser crashed'))).toBe(ExitCodes.HARNESS_FATAL);
  });

  it('4 TIMEOUT for RunTimeoutError', () => {
    expect(classifyError(new RunTimeoutError('total timeout', 30000))).toBe(ExitCodes.TIMEOUT);
  });

  it('3 HARNESS_FATAL for unknown errors', () => {
    expect(classifyError(new Error('boom'))).toBe(ExitCodes.HARNESS_FATAL);
  });

  it('6 PREFLIGHT_BLOCKED for PreflightBlockedError', () => {
    const report = {
      schemaVersion: 'preflight-report.v1' as const,
      status: 'BLOCKED' as const,
      timestamp: new Date().toISOString(),
      tokensMasked: true as const,
      checkItems: PREFLIGHT_CHECK_NAMES.map((name) => ({
        name,
        status: 'FAIL' as const,
        message: `${name} failed`,
      })),
      checks: {
        clickupToken: { ok: false },
        clickupReadAccess: { ok: false },
        clickupTaskId: { ok: false },
        githubToken: { ok: false },
        prCommentPermission: { ok: false },
        prContext: { ok: false, missing: ['GITHUB_EVENT_NAME'] },
        branchHead: { ok: false, missing: ['GITHUB_HEAD_REF'] },
        checkoutHistory: { ok: false, errors: ['missing base'] },
        config: { ok: false, errors: ['invalid'] },
      },
    };
    expect(classifyError(new PreflightBlockedError(report))).toBe(ExitCodes.PREFLIGHT_BLOCKED);
  });

  it('0 OK for preflight PASS report', () => {
    expect(
      classifyPreflightReport({
        schemaVersion: 'preflight-report.v1',
        status: 'PASS',
        timestamp: new Date().toISOString(),
        tokensMasked: true,
        checkItems: [],
        checks: {} as never,
      }),
    ).toBe(ExitCodes.OK);
  });

  it('6 PREFLIGHT_BLOCKED for preflight BLOCKED report', () => {
    expect(
      classifyPreflightReport({
        schemaVersion: 'preflight-report.v1',
        status: 'BLOCKED',
        timestamp: new Date().toISOString(),
        tokensMasked: true,
        checkItems: [],
        checks: {} as never,
      }),
    ).toBe(ExitCodes.PREFLIGHT_BLOCKED);
  });
});
