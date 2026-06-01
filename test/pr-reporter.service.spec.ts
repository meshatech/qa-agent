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
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false } },
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
    const jsonWritten: Array<{ runDir: string; name: string; data: unknown }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn((runDir, name, data) => {
        jsonWritten.push({ runDir, name, data });
        return Promise.resolve();
      }),
      writeFile: vi.fn((runDir, name, data) => {
        written.push({ runDir, name, data: String(data) });
        return Promise.resolve();
      }),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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
    expect(result.publicationWarning).toBe('Not published: token not provided');
    expect(result.publicationStatus).toEqual({ published: false, fallback: true, reason: 'Not published: token not provided' });
    expect(github.postComment).not.toHaveBeenCalled();

    const artifact = jsonWritten.find((w) => w.name === 'pr-publication-status.json');
    expect(artifact).toBeDefined();
    expect(artifact!.data).toMatchObject({
      version: 1,
      attempted: false,
      published: false,
      fallback: true,
      reason: 'Not published: token not provided',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md');
    expect(report).toBeDefined();
    expect(report!.data).toContain('# QA Agent — PR Report');
    expect(report!.data).toContain('**Status:** PASSED');
    expect(report!.data).toContain('**Repository:** owner/repo');
    expect(report!.data).toContain('**Pull Request:** #42');
    expect(report!.data).toContain('## PR Publication Status');
    expect(report!.data).toContain('Published to PR:** no');
    expect(report!.data).toContain('Fallback local:** yes');
    expect(report!.data).toContain('Not published: token not provided');
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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
    expect(result.publicationStatus).toEqual({ published: true, fallback: false });
    expect(github.postComment).toHaveBeenCalledOnce();
    expect(github.postComment).toHaveBeenCalledWith({
      repository: 'owner/repo',
      pullNumber: 42,
      body: expect.stringContaining('# QA Agent — PR Report'),
      token: 'ghp_fake_token_123',
    });

    const writeJsonCalls = (repo.writeJson as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, unknown]>;
    const artifactCall = writeJsonCalls.find((c) => c[1] === 'pr-publication-status.json');
    expect(artifactCall).toBeDefined();
    expect(artifactCall![2]).toMatchObject({
      version: 1,
      attempted: true,
      published: true,
      fallback: false,
      repository: 'owner/repo',
      pullNumber: 42,
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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
    expect(result.publicationWarning).toBe('Not published: token lacks permission');
    expect(result.publicationStatus).toEqual({ published: false, fallback: true, reason: 'Not published: token lacks permission' });
    expect(result.reportPath).toBe('pr-report.md');

    const writeJsonCalls = (repo.writeJson as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, unknown]>;
    const artifact = writeJsonCalls.find((c) => c[1] === 'pr-publication-status.json');
    expect(artifact).toBeDefined();
    expect(artifact![2]).toMatchObject({
      version: 1,
      attempted: true,
      published: false,
      fallback: true,
      reason: 'Not published: token lacks permission',
      repository: 'owner/repo',
      pullNumber: 42,
      statusCode: 403,
    });

    const writeCalls = (repo.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string]>;
    const markdown = writeCalls.find((c) => c[1] === 'pr-report.md')?.[2] ?? '';
    expect(markdown).toContain('## PR Publication Status');
    expect(markdown).toContain('Published to PR:** no');
    expect(markdown).toContain('Fallback local:** yes');
    expect(markdown).toContain('Not published: token lacks permission');
  });

  it('maps 401 to specific fallback message', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(), ensureDir: vi.fn(), writeJson: vi.fn(), writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(), findRunDir: vi.fn(), readJson: vi.fn(), readFile: vi.fn(), exists: vi.fn(), listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new GitHubCommentError('Unauthorized', 401))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(), config: makeConfig(), runDir: '/tmp/run-001',
      repository: 'owner/repo', pullNumber: 42, token: 'ghp_test',
    });

    expect(result.publicationWarning).toBe('Not published: invalid or unauthorized token');
    expect(result.publicationStatus?.reason).toBe('Not published: invalid or unauthorized token');
  });

  it('maps 404 to specific fallback message', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(), ensureDir: vi.fn(), writeJson: vi.fn(), writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(), findRunDir: vi.fn(), readJson: vi.fn(), readFile: vi.fn(), exists: vi.fn(), listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new GitHubCommentError('Not Found', 404))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(), config: makeConfig(), runDir: '/tmp/run-001',
      repository: 'owner/repo', pullNumber: 42, token: 'ghp_test',
    });

    expect(result.publicationWarning).toBe('Not published: repository or pull request not found');
  });

  it('maps network failure to generic message', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(), ensureDir: vi.fn(), writeJson: vi.fn(), writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(), findRunDir: vi.fn(), readJson: vi.fn(), readFile: vi.fn(), exists: vi.fn(), listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new Error('Network timeout'))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(), config: makeConfig(), runDir: '/tmp/run-001',
      repository: 'owner/repo', pullNumber: 42, token: 'ghp_test',
    });

    expect(result.publicationWarning).toBe('Not published: GitHub API request failed');
  });

  it('includes publication status in final markdown on success', async () => {
    const written: Array<{ runDir: string; name: string; data: string }> = [];
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(), ensureDir: vi.fn(), writeJson: vi.fn(),
      writeFile: vi.fn((runDir, name, data) => { written.push({ runDir, name, data: String(data) }); return Promise.resolve(); }),
      writeReport: vi.fn(), findRunDir: vi.fn(), readJson: vi.fn(), readFile: vi.fn(), exists: vi.fn(), listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn(() => Promise.resolve()) };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult(), config: makeConfig(), runDir: '/tmp/run-001',
      repository: 'owner/repo', pullNumber: 42, token: 'ghp_test',
    });

    const report = written.find((w) => w.name === 'pr-report.md');
    expect(report!.data).toContain('## PR Publication Status');
    expect(report!.data).toContain('Published to PR:** yes');
    expect(report!.data).toContain('Fallback local:** no');
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new GitHubCommentError('ghp_secret_123 failed', 418))),
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

    const writeJsonCalls = (repo.writeJson as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, unknown]>;
    const artifact = writeJsonCalls.find((c) => c[1] === 'pr-publication-status.json');
    const artifactJson = JSON.stringify(artifact?.[2]);
    expect(artifactJson).not.toContain('ghp_secret_123');
  });

  it('never leaks CLICKUP_TOKEN or pk_ token into outputs', async () => {
    const repo: RunRepositoryPort = {
      createRunDir: vi.fn(),
      ensureDir: vi.fn(),
      writeJson: vi.fn(),
      writeFile: vi.fn(() => Promise.resolve()),
      writeReport: vi.fn(),
      findRunDir: vi.fn(),
      readJson: vi.fn(),
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = {
      postComment: vi.fn(() => Promise.reject(new GitHubCommentError('pk_test_abc123 failed', 418))),
    };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    const result = await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
      token: 'ghp_test',
    });

    expect(result.publicationWarning).toBeDefined();
    expect(result.publicationWarning).not.toContain('pk_test_abc123');

    const writeCalls = (repo.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string]>;
    const markdown = writeCalls.find((c) => c[1] === 'pr-report.md')?.[2] ?? '';
    expect(markdown).not.toContain('pk_test_abc123');

    const writeJsonCalls = (repo.writeJson as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, unknown]>;
    const artifact = writeJsonCalls.find((c) => c[1] === 'pr-publication-status.json');
    const artifactJson = JSON.stringify(artifact?.[2]);
    expect(artifactJson).not.toContain('pk_test_abc123');
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
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

  it('renders covered acceptance criteria with coverage map when criteria match scenarios', async () => {
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login do usuário', status: 'PASSED', tasks: [] },
        ],
      }),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['Usuário consegue fazer login'] },
      }),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('## Covered Acceptance Criteria');
    expect(report).toContain('Usuário consegue fazer login');
    expect(report).toContain('Login do usuário');
    expect(report).toContain('lexical');
  });

  it('renders uncovered acceptance criteria for gaps not covered by scenarios', async () => {
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn(),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult({
        scenarios: [
          { id: 's1', title: 'Login do usuário', status: 'PASSED', tasks: [] },
        ],
      }),
      config: makeConfig({
        demand: { id: 'DEM-001', title: 'Test', description: 'Test', acceptanceCriteria: ['Usuário consegue fazer login', 'Admin pode exportar relatório'] },
      }),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('## Uncovered Acceptance Criteria');
    expect(report).toContain('Admin pode exportar relatório');
    expect(report).toContain('⚠️');

    // Verify covered criterion does not appear in uncovered section
    const uncoveredSection = report.split('## Uncovered Acceptance Criteria')[1]?.split('## Scenarios')[0] ?? '';
    expect(uncoveredSection).not.toContain('Usuário consegue fazer login');
  });

  it('discovers and renders evidence links for bugs with existing files', async () => {
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn().mockImplementation((_runDir, path) => {
        if (path === 'bugs/BUG-001') return Promise.resolve(['screenshot.png', 'console.log', 'unknown.txt']);
        return Promise.resolve([]);
      }),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
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
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md')!.data;
    expect(report).toContain('Screenshot: `bugs/BUG-001/screenshot.png`');
    expect(report).toContain('Console log: `bugs/BUG-001/console.log`');
    expect(report).not.toContain('unknown.txt');
  });

  it('does not break report when evidence discovery fails', async () => {
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
      readFile: vi.fn(),
      exists: vi.fn(),
      listFiles: vi.fn().mockRejectedValue(new Error('Disk read error')),
      appendRunHistory: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    };
    const github: GitHubCommentPort = { postComment: vi.fn() };
    const service = new PRReporterService(github, repo, new PRReportRenderer());

    await service.report({
      result: makeResult(),
      config: makeConfig(),
      runDir: '/tmp/run-001',
      repository: 'owner/repo',
      pullNumber: 42,
    });

    const report = written.find((w) => w.name === 'pr-report.md');
    expect(report).toBeDefined();
    expect(report!.data).toContain('# QA Agent');
  });
});
