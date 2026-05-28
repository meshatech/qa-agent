import { describe, expect, it } from 'vitest';
import { PRReportRenderer } from '../src/application/services/pr-report-renderer.service.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';

function makeResult(overrides?: Partial<QaRunResult>): QaRunResult {
  return {
    status: 'PASSED',
    runDir: '/tmp/run-001',
    steps: [],
    bugs: [],
    scenarios: [],
    ...overrides,
  };
}

describe('PRReportRenderer', () => {
  const renderer = new PRReportRenderer();

  it('renders minimal report with no scenarios, bugs, or metrics', () => {
    const md = renderer.render({
      result: makeResult(),
      repository: 'owner/repo',
      pullNumber: 42,
    });

    expect(md).toContain('# QA Agent — PR Report');
    expect(md).toContain('**Status:** PASSED');
    expect(md).toContain('**Repository:** owner/repo');
    expect(md).toContain('**Pull Request:** #42');
    expect(md).toContain('## Summary');
    expect(md).toContain('- Scenarios: 0');
    expect(md).toContain('- Bugs: 0');
    expect(md).toContain('- Warnings: 0');
    expect(md).not.toContain('## Scenarios');
    expect(md).not.toContain('## Bugs');
    expect(md).not.toContain('## Warnings');
    expect(md).toContain('## Artifacts');
  });

  it('renders PR metadata when provided', () => {
    const md = renderer.render({
      result: makeResult(),
      repository: 'owner/repo',
      pullNumber: 42,
      commitSha: 'abc123',
      headRef: 'feature/foo',
      baseRef: 'main',
    });

    expect(md).toContain('**Commit:** abc123');
    expect(md).toContain('**Base:** main');
    expect(md).toContain('**Head:** feature/foo');
  });

  it('renders scenarios table when scenarios exist', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login', status: 'PASSED', tasks: [] },
          { id: 's2', title: 'Logout', status: 'FAILED', tasks: [] },
        ],
      }),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Scenarios');
    expect(md).toContain('| Login | PASSED |');
    expect(md).toContain('| Logout | FAILED |');
  });

  it('renders bugs section when bugs exist', () => {
    const md = renderer.render({
      result: makeResult({
        bugs: [{
          bugId: 'BUG-001',
          stepId: 'S1',
          classification: { isBug: true, severity: 'HIGH', category: 'APP_FAULT', reason: 'Crash' },
          path: 'bugs/BUG-001',
          capturedAt: '2026-01-01T00:00:00Z',
        }],
      }),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Bugs');
    expect(md).toContain('BUG-001');
    expect(md).toContain('HIGH');
    expect(md).toContain('Crash');
    expect(md).toContain('bugs/BUG-001/bug-report.md');
  });

  it('renders warnings from planRuntime', () => {
    const result = makeResult();
    (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = {
      warnings: [{ stepId: 'planner', message: 'FALLBACK' }],
    };

    const md = renderer.render({
      result,
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Warnings');
    expect(md).toContain('planner: FALLBACK');
  });

  it('prefers metrics over inline calculations when both present', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'A', status: 'PASSED', tasks: [] },
        ],
        metrics: {
          totalScenarios: 10,
          passedScenarios: 5,
          failedScenarios: 3,
          blockedScenarios: 2,
          totalTasks: 1,
          passedTasks: 1,
          failedTasks: 0,
          skippedTasks: 0,
          totalSteps: 1,
          passedSteps: 1,
          failedSteps: 0,
          totalBugs: 0,
          bugsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          totalDurationMs: 1000,
        },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('- Scenarios: 10');
    expect(md).toContain('- Passed: 5');
    expect(md).toContain('- Failed: 3');
    expect(md).toContain('- Blocked: 2');
  });
});
