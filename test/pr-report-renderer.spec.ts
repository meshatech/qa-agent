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
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    evidence: { video: 'off', trace: 'off' },
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
    expect(md).toContain('## Bugs');
    expect(md).toContain('_No bugs were reported._');
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

  it('renders covered acceptance criteria when coverageMap provided', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [
        { criterion: 'User can login', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical', evidence: 'task.title' },
      ],
    });

    expect(md).toContain('## Covered Acceptance Criteria');
    expect(md).toContain('User can login');
    expect(md).toContain('Login');
    expect(md).toContain('lexical');
    expect(md).toContain('0.72');
  });

  it('renders empty covered criteria message when coverageMap is empty', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [],
    });

    expect(md).toContain('## Covered Acceptance Criteria');
    expect(md).toContain('_No acceptance criteria were mapped to executed scenarios._');
  });

  it('omits covered criteria section when demand has no acceptance criteria', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [],
    });

    expect(md).not.toContain('## Covered Acceptance Criteria');
  });

  it('sanitizes pipe characters in covered criteria table', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User | Admin'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [
        { criterion: 'User | Admin', scenarioId: 's1', scenarioTitle: 'Login | Auth', score: 0.50, source: 'lexical' },
      ],
    });

    expect(md).toContain('User \\| Admin');
    expect(md).toContain('Login \\| Auth');
  });

  it('renders uncovered acceptance criteria when present', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login', 'Admin can export'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [
        { criterion: 'User can login', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical' },
      ],
      uncoveredCriteria: ['Admin can export'],
    });

    expect(md).toContain('## Uncovered Acceptance Criteria');
    expect(md).toContain('Admin can export');
    expect(md).toContain('⚠️');

    const uncoveredSection = md.split('## Uncovered Acceptance Criteria')[1]?.split('## Scenarios')[0] ?? '';
    expect(uncoveredSection).not.toContain('User can login');
  });

  it('omits uncovered acceptance criteria section when empty', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login'] },
      }),
      repository: 'owner/repo',
      pullNumber: 1,
      coverageMap: [
        { criterion: 'User can login', scenarioId: 's1', scenarioTitle: 'Login', score: 0.72, source: 'lexical' },
      ],
      uncoveredCriteria: [],
    });

    expect(md).not.toContain('## Uncovered Acceptance Criteria');
  });

  it('omits uncovered acceptance criteria section when demand has no acceptance criteria', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      uncoveredCriteria: [],
    });

    expect(md).not.toContain('## Uncovered Acceptance Criteria');
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
    expect(md).toContain('APP_FAULT');
    expect(md).toContain('Crash');
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

  it('renders evidence links for bugs when evidenceMap provided', () => {
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
      evidenceMap: {
        byBugId: {
          'BUG-001': [
            { type: 'bugReport', label: 'Bug report', path: 'bugs/BUG-001/bug-report.md' },
            { type: 'screenshot', label: 'Screenshot', path: 'bugs/BUG-001/screenshot.png' },
            { type: 'video', label: 'Video', path: 'bugs/BUG-001/video.webm' },
          ],
        },
      },
    });

    expect(md).toContain('Bug report: `bugs/BUG-001/bug-report.md`');
    expect(md).toContain('Screenshot: `bugs/BUG-001/screenshot.png`');
    expect(md).toContain('Video: `bugs/BUG-001/video.webm`');
  });

  it('omits evidence links for bugs without evidenceMap', () => {
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
    expect(md).not.toContain('Screenshot');
    expect(md).not.toContain('Video');
  });

  it('renders bug with all optional fields', () => {
    const md = renderer.render({
      result: makeResult({
        bugs: [{
          bugId: 'BUG-002',
          stepId: 'STP-01',
          scenarioId: 'SCN-01',
          taskId: 'TSK-01',
          classification: { isBug: true, severity: 'CRITICAL', category: 'ASSERTION_FAULT', reason: 'Button not clickable' },
          path: 'bugs/BUG-002',
          url: '/checkout',
          expected: 'Button enabled',
          actual: 'Button disabled',
          signalType: 'ASSERTION_FAILURE',
          capturedAt: '2026-01-01T00:00:00Z',
        }],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('BUG-002');
    expect(md).toContain('CRITICAL');
    expect(md).toContain('ASSERTION_FAULT');
    expect(md).toContain('Button not clickable');
    expect(md).toContain('URL: `/checkout`');
    expect(md).toContain('Expected: Button enabled');
    expect(md).toContain('Actual: Button disabled');
    expect(md).toContain('Signal: ASSERTION_FAILURE');
    expect(md).toContain('Scenario: `SCN-01`');
    expect(md).toContain('Task: `TSK-01`');
    expect(md).toContain('Step: `STP-01`');
  });

  it('uses UNCLASSIFIED fallback when category is missing', () => {
    const md = renderer.render({
      result: makeResult({
        bugs: [{
          bugId: 'BUG-003',
          stepId: 'S1',
          classification: { isBug: true, severity: 'MEDIUM', category: undefined as unknown as 'APP_FAULT', reason: 'Slow response' },
          path: 'bugs/BUG-003',
          capturedAt: '2026-01-01T00:00:00Z',
        }],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('UNCLASSIFIED');
    expect(md).toContain('MEDIUM');
    expect(md).toContain('Slow response');
  });

  it('uses UNKNOWN fallback when severity is missing', () => {
    const md = renderer.render({
      result: makeResult({
        bugs: [{
          bugId: 'BUG-004',
          stepId: 'S1',
          classification: { isBug: true, severity: undefined as unknown as 'HIGH', category: 'APP_FAULT', reason: 'Timeout' },
          path: 'bugs/BUG-004',
          capturedAt: '2026-01-01T00:00:00Z',
        }],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('UNKNOWN');
    expect(md).toContain('APP_FAULT');
  });

  it('omits optional sublines when fields are absent', () => {
    const md = renderer.render({
      result: makeResult({
        bugs: [{
          bugId: 'BUG-005',
          stepId: 'S1',
          classification: { isBug: true, severity: 'LOW', category: 'NAVIGATION_FAULT', reason: '404' },
          path: 'bugs/BUG-005',
          capturedAt: '2026-01-01T00:00:00Z',
        }],
      }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    const bugSection = md.split('## Bugs')[1]?.split('## Warnings')[0] ?? '';
    expect(bugSection).not.toContain('URL:');
    expect(bugSection).not.toContain('Expected:');
    expect(bugSection).not.toContain('Actual:');
    expect(bugSection).not.toContain('Signal:');
    expect(bugSection).not.toContain('Scenario:');
    expect(bugSection).not.toContain('Task:');
  });

  it('renders no bugs message when bugs array is empty', () => {
    const md = renderer.render({
      result: makeResult({ bugs: [] }),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).toContain('## Bugs');
    expect(md).toContain('_No bugs were reported._');
  });

  it('renders blocks section when blocks provided', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      blocks: [
        {
          scenarioId: 'SCN-01',
          scenarioTitle: 'Checkout',
          source: 'scenario',
          reason: 'Scenario blocked: Checkout',
        },
        {
          scenarioId: 'SCN-01',
          taskId: 'TSK-01',
          taskTitle: 'Confirm payment',
          source: 'task',
          reason: 'Task blocked: Confirm payment',
        },
        {
          scenarioId: 'SCN-01',
          taskId: 'TSK-01',
          stepId: 'STP-01',
          code: 'TASK_DEPENDENCY_BLOCKED',
          source: 'step',
          reason: 'TASK_DEPENDENCY_BLOCKED: Previous task not completed',
        },
      ],
    });

    expect(md).toContain('## Blocks');
    expect(md).toContain('| scenario |');
    expect(md).toContain('| task |');
    expect(md).toContain('| step |');
    expect(md).toContain('SCN-01');
    expect(md).toContain('TSK-01');
    expect(md).toContain('STP-01');
    expect(md).toContain('TASK_DEPENDENCY_BLOCKED');
    expect(md).toContain('Scenario blocked: Checkout');
  });

  it('omits blocks section when blocks array is empty', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      blocks: [],
    });

    expect(md).not.toContain('## Blocks');
  });

  it('escapes pipe in block reason for markdown table', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      blocks: [
        {
          scenarioId: 'SCN-01',
          source: 'step',
          reason: 'Error: A | B | C',
        },
      ],
    });

    expect(md).toContain('Error: A \\| B \\| C');
    expect(md).toContain('## Blocks');
  });

  it('renders publication status when published', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      publicationStatus: { published: true, fallback: false },
    });

    expect(md).toContain('## PR Publication Status');
    expect(md).toContain('Published to PR:** yes');
    expect(md).toContain('Fallback local:** no');
    expect(md).not.toContain('Reason:');
  });

  it('renders publication status with fallback and reason', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      publicationStatus: { published: false, fallback: true, reason: 'Not published: token lacks permission' },
    });

    expect(md).toContain('## PR Publication Status');
    expect(md).toContain('Published to PR:** no');
    expect(md).toContain('Fallback local:** yes');
    expect(md).toContain('Not published: token lacks permission');
  });

  it('omits publication status section when not provided', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(md).not.toContain('## PR Publication Status');
  });

  it('sanitizes reason in publication status', () => {
    const md = renderer.render({
      result: makeResult(),
      config: makeConfig(),
      repository: 'owner/repo',
      pullNumber: 1,
      publicationStatus: { published: false, fallback: true, reason: 'Error: A | B' },
    });

    expect(md).toContain('Error: A \\| B');
  });
});
