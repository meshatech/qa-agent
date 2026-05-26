import { describe, expect, it } from 'vitest';

import {
  PREFLIGHT_CHECK_NAMES,
  PreflightReportSchema,
} from '../src/domain/schemas/preflight-report.schema.js';

const VALID_REPORT = {
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
    clickupReadAccess: { ok: true, statusCode: 200 },
    clickupTaskId: { ok: true },
    githubToken: { ok: true },
    prCommentPermission: { ok: true, statusCode: 200 },
    prContext: { ok: true, missing: [] },
    branchHead: { ok: true, branchHead: 'feature/test', missing: [] },
    checkoutHistory: { ok: true, errors: [], baseRef: 'main', shallow: false },
    config: { ok: true, errors: [], configPath: './agent-qa.config.json' },
  },
};

describe('PreflightReportSchema', () => {
  it('accepts a valid preflight-report.v1 shape', () => {
    expect(PreflightReportSchema.parse(VALID_REPORT)).toEqual(VALID_REPORT);
  });

  it('rejects reports without checkItems', () => {
    const { checkItems: _removed, ...withoutCheckItems } = VALID_REPORT;
    expect(() => PreflightReportSchema.parse(withoutCheckItems)).toThrow();
  });

  it('rejects reports when tokensMasked is false', () => {
    expect(() =>
      PreflightReportSchema.parse({ ...VALID_REPORT, tokensMasked: false }),
    ).toThrow();
  });

  it('rejects reports with wrong checkItems length', () => {
    expect(() =>
      PreflightReportSchema.parse({
        ...VALID_REPORT,
        checkItems: VALID_REPORT.checkItems.slice(0, 5),
      }),
    ).toThrow();
  });
});
