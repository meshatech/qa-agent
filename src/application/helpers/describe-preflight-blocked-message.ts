import {
  BLOCKING_PREFLIGHT_CHECKS,
  type PreflightCheckName,
  type PreflightReport,
} from '../../domain/schemas/preflight-report.schema.js';

const GENERIC_FALLBACK = 'QA bloqueado: vincule a task do ClickUp ao PR.';

export function describePreflightBlockedMessage(report: PreflightReport): string {
  const blocking = new Set<PreflightCheckName>(BLOCKING_PREFLIGHT_CHECKS);
  const failed = report.checkItems.filter(
    (item) => item.status === 'FAIL' && blocking.has(item.name),
  );

  if (failed.length === 0) {
    return GENERIC_FALLBACK;
  }

  return `QA bloqueado: ${failed.map((item) => item.message).join('; ')}`;
}
