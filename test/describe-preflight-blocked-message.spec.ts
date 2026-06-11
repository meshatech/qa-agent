import { describe, expect, it } from 'vitest';

import { describePreflightBlockedMessage } from '../src/application/helpers/describe-preflight-blocked-message.js';
import { PREFLIGHT_CHECK_NAMES } from '../src/domain/schemas/preflight-report.schema.js';

const baseReport = {
  schemaVersion: 'preflight-report.v1' as const,
  status: 'BLOCKED' as const,
  timestamp: new Date().toISOString(),
  tokensMasked: true as const,
  checkItems: PREFLIGHT_CHECK_NAMES.map((name) => ({
    name,
    status: 'PASS' as const,
    message: `${name} ok`,
  })),
  checks: {} as never,
};

describe('describePreflightBlockedMessage', () => {
  it('returns specific reason when CLICKUP_TOKEN check fails', () => {
    const report = {
      ...baseReport,
      checkItems: baseReport.checkItems.map((item) =>
        item.name === 'clickupToken'
          ? { ...item, status: 'FAIL' as const, message: 'CLICKUP_TOKEN is missing' }
          : item,
      ),
    };

    expect(describePreflightBlockedMessage(report)).toBe('QA bloqueado: CLICKUP_TOKEN is missing');
  });

  it('joins multiple blocking failures', () => {
    const report = {
      ...baseReport,
      checkItems: baseReport.checkItems.map((item) => {
        if (item.name === 'clickupToken') {
          return { ...item, status: 'FAIL' as const, message: 'CLICKUP_TOKEN is missing' };
        }
        if (item.name === 'config') {
          return { ...item, status: 'FAIL' as const, message: 'Config file not found' };
        }
        return item;
      }),
    };

    expect(describePreflightBlockedMessage(report)).toBe(
      'QA bloqueado: CLICKUP_TOKEN is missing; Config file not found',
    );
  });

  it('falls back to generic task message when no FAIL blocking checks', () => {
    expect(describePreflightBlockedMessage(baseReport)).toBe(
      'QA bloqueado: vincule a task do ClickUp ao PR.',
    );
  });
});
