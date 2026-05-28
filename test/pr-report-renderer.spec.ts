import { describe, expect, it } from 'vitest';
import { PRReportRenderer } from '../src/application/services/pr-report-renderer.service.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(overrides?: Partial<RunConfig>): RunConfig {
  return {
    baseUrl: 'http://localhost:3000',
    appDomains: ['localhost'],
    demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: [] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    scenarioSelection: { maxScenarios: 5 },
    agentVersion: '0.1.0',
    ...overrides,
  };
}

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
      config: makeConfig(),
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
    expect(md).toContain('## Scenarios');
    expect(md).toContain('_No scenarios were reported._');
    expect(md).not.toContain('## Bugs');
    expect(md).not.toContain('## Warnings');
    expect(md).toContain('## Artifacts');
  });

  it('renders PR metadata when provided', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
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

  it('renders scenarios table with task count when scenarios exist', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login', status: 'PASSED', tasks: [] },
          { id: 's2', title: 'Logout', status: 'FAILED', tasks: [] },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Scenarios');
    expect(md).toContain('| Scenario | Status | Tasks |');
    expect(md).toContain('| Login | PASSED | 0 |');
    expect(md).toContain('| Logout | FAILED | 0 |');
    expect(md).toContain('### Login');
    expect(md).toContain('### Logout');
    expect(md).toContain('_No tasks reported for this scenario._');
  });

  it('renders tasks with id, status and title under each scenario', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          {
            id: 's1',
            title: 'Login',
            status: 'PASSED',
            tasks: [
              { id: 'T001', title: 'Enter username', expected: 'username visible', status: 'PASSED' },
              { id: 'T002', title: 'Enter password', expected: 'password masked', status: 'PASSED' },
            ],
          },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('### Login');
    expect(md).toContain('- T001 — PASSED — Enter username');
    expect(md).toContain('- T002 — PASSED — Enter password');
    expect(md).toContain('| Login | PASSED | 2 |');
  });

  it('does not hide failed scenarios', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login', status: 'PASSED', tasks: [] },
          { id: 's2', title: 'Checkout', status: 'FAILED', tasks: [] },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Scenarios');
    expect(md).toContain('| Checkout | FAILED |');
    expect(md).toContain('### Checkout');
  });

  it('renders tasks with multiple statuses including FAILED, BLOCKED, SKIPPED', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          {
            id: 's1',
            title: 'Checkout',
            status: 'FAILED',
            tasks: [
              { id: 'T003', title: 'Add item', expected: 'item added', status: 'PASSED' },
              { id: 'T004', title: 'Apply coupon', expected: 'coupon applied', status: 'FAILED' },
              { id: 'T005', title: 'Confirm payment', expected: 'payment confirmed', status: 'BLOCKED' },
              { id: 'T006', title: 'Send receipt', expected: 'receipt sent', status: 'SKIPPED' },
            ],
          },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('- T003 — PASSED — Add item');
    expect(md).toContain('- T004 — FAILED — Apply coupon');
    expect(md).toContain('- T005 — BLOCKED — Confirm payment');
    expect(md).toContain('- T006 — SKIPPED — Send receipt');
  });

  it('renders UNKNOWN for missing status', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          {
            id: 's1',
            title: 'Ambiguous',
            status: undefined as unknown as 'PASSED',
            tasks: [
              { id: 'T001', title: 'Step', expected: 'done', status: undefined as unknown as 'PASSED' },
            ],
          },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('| Ambiguous | UNKNOWN |');
    expect(md).toContain('- T001 — UNKNOWN — Step');
  });

  it('normalizes passed_with_warnings status', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login', status: 'PASSED_WITH_WARNINGS', tasks: [] },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('| Login | PASSED_WITH_WARNINGS |');
  });

  it('sanitizes pipe characters in scenario title for markdown table', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login | Auth', status: 'PASSED', tasks: [] },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('Login \\| Auth');
    expect(md).not.toContain('Login | Auth |');
  });

  it('falls back to Untitled scenario when title and id are missing', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          { id: '', title: '', status: 'PASSED', tasks: [] },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('Untitled scenario');
  });

  it('falls back to Untitled task when title and expected are missing', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          {
            id: 's1',
            title: 'Login',
            status: 'PASSED',
            tasks: [
              { id: 'T001', title: '', expected: '', status: 'PASSED' },
            ],
          },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('- T001 — PASSED — Untitled task');
  });

  it('preserves original order of scenarios and tasks', () => {
    const md = renderer.render({
      result: makeResult({
        scenarios: [
          {
            id: 's1',
            title: 'First',
            status: 'PASSED',
            tasks: [
              { id: 'T001', title: 'A', expected: 'a', status: 'PASSED' },
              { id: 'T002', title: 'B', expected: 'b', status: 'PASSED' },
            ],
          },
          {
            id: 's2',
            title: 'Second',
            status: 'FAILED',
            tasks: [
              { id: 'T003', title: 'C', expected: 'c', status: 'FAILED' },
            ],
          },
        ],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    const firstScenarioIndex = md.indexOf('### First');
    const secondScenarioIndex = md.indexOf('### Second');
    const taskAIndex = md.indexOf('T001');
    const taskBIndex = md.indexOf('T002');

    expect(firstScenarioIndex).toBeLessThan(secondScenarioIndex);
    expect(taskAIndex).toBeLessThan(taskBIndex);
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
      config: makeConfig(),
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
      config: makeConfig(),
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
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('- Scenarios: 10');
    expect(md).toContain('- Passed: 5');
    expect(md).toContain('- Failed: 3');
    expect(md).toContain('- Blocked: 2');
  });

  it('renders acceptance criteria when present', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login', 'User can logout'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Acceptance Criteria');
    expect(md).toContain('- User can login');
    expect(md).toContain('- User can logout');
  });

  it('omits acceptance criteria section when empty', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).not.toContain('## Acceptance Criteria');
  });
});
