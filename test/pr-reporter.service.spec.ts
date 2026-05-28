import { describe, expect, it, vi } from 'vitest';
import { PRReporterService } from '../src/application/services/pr-reporter.service.js';
import { PRReportRenderer } from '../src/application/services/pr-report-renderer.service.js';
import type { GitHubCommentPort } from '../src/application/ports/github-comment.port.js';
import type { RunRepositoryPort } from '../src/application/ports/run-repository.port.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import { GitHubCommentError } from '../src/domain/errors.js';

function makeConfig(overrides?: Partial<RunConfig>): RunConfig {
  return {
    baseUrl: 'http://localhost:3000',
    appDomains: ['localhost'],
    demand: { id: 'DEM-001', title: 'Test Demand', description: 'Test', acceptanceCriteria: [] },
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

describe('PRReporterService', () => {
  it('generates pr-report.md locally without publishing when token is absent', async () => {
    const written: Array<{ runDir: string; name: string; data: string }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn((runDir, name, data) => {
        written.push({ runDir, name, data: String(data) });
        return Promise.resolve();
      }),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    expect(result.published).toBe(false);
    expect(result.reportPath).toBe('pr-report.md');
    expect(result.publicationWarning).toBeUndefined();
    expect(github.postComment).not.toHaveBeenCalled();

    const report = written.find((w) => w.name === 'pr-report.md');
    expect(report).toBeDefined();
    expect(report!.data).toContain('# QA Agent — PR Report');
    expect(report!.data).toContain('**Status:** PASSED');
    expect(report!.data).toContain('**Repository:** owner/repo');
    expect(report!.data).toContain('**Pull Request:** #42');
  });

  it('publishes comment when token is provided and API succeeds', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn(() => Promise.resolve()) };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
      token: 'ghp_fake_token_123',
    });

    expect(result.published).toBe(true);
    expect(result.publicationWarning).toBeUndefined();
    expect(github.postComment).toHaveBeenCalledOnce();
    expect(github.postComment).toHaveBeenCalledWith({
      repository: 'owner/repo',
      pullNumber: 42,
      body: expect.stringContaining('# QA Agent — PR Report'),
      token: 'ghp_fake_token_123',
    });
  });

  it('falls back to local report when publication fails', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new GitHubCommentError('Forbidden', 403))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
      token: 'ghp_fake_token_123',
    });

    expect(result.published).toBe(false);
    expect(result.publicationWarning).toBeDefined();
    expect(result.reportPath).toBe('pr-report.md');
  });

  it('renders scenarios, bugs and warnings in pr-report.md', async () => {
    const written: Array<{ runDir: string; name: string; data: string }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn((runDir, name, data) => {
        written.push({ runDir, name, data: String(data) });
        return Promise.resolve();
      }),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const runResult = makeResult({
      status: 'FAILED',
      scenarios: [
        { id: 's1', title: 'Login válido', status: 'PASSED', tasks: [] },
        { id: 's2', title: 'Logout', status: 'FAILED', tasks: [] },
      ],
      bugs: [{
        bugId: 'BUG-001',
        stepId: 'S1',
        classification: { isBug: true, severity: 'HIGH', category: 'APP_FAULT', reason: 'Logout não redireciona' },
        path: 'bugs/BUG-001',
        capturedAt: '2026-01-01T00:00:00Z',
      }],
      metrics: {
        totalScenarios: 2,
        passedScenarios: 1,
        failedScenarios: 1,
        blockedScenarios: 0,
        totalTasks: 4,
        passedTasks: 2,
        failedTasks: 1,
        skippedTasks: 1,
        totalSteps: 4,
        passedSteps: 2,
        failedSteps: 2,
        totalBugs: 1,
        bugsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
        totalDurationMs: 120000,
      },
    });
    (runResult as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime = {
      warnings: [{ stepId: 'planner', message: 'LLM_BUILD_PLAN_FALLBACK_TO_FACTORY' }],
    };

    await service.report({
      result: runResult,
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
      commitSha: 'abc123',
      headRef: 'feature/foo',
      baseRef: 'main',
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('**Status:** FAILED');
    expect(report).toContain('**Commit:** abc123');
    expect(report).toContain('**Base:** main');
    expect(report).toContain('**Head:** feature/foo');
    expect(report).toContain('## Scenarios');
    expect(report).toContain('| Login válido | PASSED |');
    expect(report).toContain('| Logout | FAILED |');
    expect(report).toContain('## Bugs');
    expect(report).toContain('BUG-001');
    expect(report).toContain('HIGH');
    expect(report).toContain('## Warnings');
    expect(report).toContain('LLM_BUILD_PLAN_FALLBACK_TO_FACTORY');
    expect(report).toContain('## Artifacts');
    expect(report).toContain('execution-report.md');
  });

  it('never leaks token into markdown, warning or error', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new Error('ghp_secret_123 failed'))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
      token: 'ghp_secret_123',
    });

    expect(result.publicationWarning).toBeDefined();
    expect(result.publicationWarning).not.toContain('ghp_secret_123');
    expect(result.publicationWarning).toContain('[REDACTED]');

    const writeCalls = (repo.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string]>;
    const markdown = writeCalls.find((c) => c[1] === 'pr-report.md')?.[2] ?? '';
    expect(markdown).not.toContain('ghp_secret_123');
  });

  it('renders report without metrics using inline calculations', async () => {
    const written: Array<{ runDir: string; name: string; data: string }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn((runDir, name, data) => {
        written.push({ runDir, name, data: String(data) });
        return Promise.resolve();
      }),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'A', status: 'PASSED', tasks: [] },
          { id: 's2', title: 'B', status: 'FAILED', tasks: [] },
        ],
        metrics: undefined,
      }),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('- Scenarios: 2');
    expect(report).toContain('- Passed: 1');
    expect(report).toContain('- Failed: 1');
  });

  it('renders acceptance criteria when config.demand has criteria', async () => {
    const written: Array<{ runDir: string; name: string; data: string }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn((runDir, name, data) => {
        written.push({ runDir, name, data: String(data) });
        return Promise.resolve();
      }),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult(),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['User can login'] },
      }),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('## Acceptance Criteria');
    expect(report).toContain('- User can login');
  });
});
