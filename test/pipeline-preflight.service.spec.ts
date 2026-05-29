import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelinePreflightService } from '../src/application/services/pipeline-preflight.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import {
  PREFLIGHT_CHECK_NAMES,
  PreflightReportSchema,
} from '../src/domain/schemas/preflight-report.schema.js';
import { PreflightBlockedError } from '../src/domain/errors.js';
import type { ClickUpApiPort } from '../src/application/ports/clickup-api.port.js';
import type { GitHubApiPort } from '../src/application/ports/github-api.port.js';
import type { GitRepositoryPort } from '../src/application/ports/git-repository.port.js';
import type { PreflightReportWriterPort } from '../src/application/ports/preflight-report-writer.port.js';
import type { GitHubEventContextPort } from '../src/application/ports/github-event-context.port.js';
import { ValidateConfigUseCase } from '../src/application/use-cases/validate-config.usecase.js';
import { FileConfigLoader } from '../src/infra/config/file-config.loader.js';
import { FilePreflightReportWriterAdapter } from '../src/infra/persistence/file-preflight-report-writer.adapter.js';
import { FileGitHubEventContextAdapter } from '../src/infra/github/file-github-event-context.adapter.js';
import * as githubPrContextMapper from '../src/infra/github/github-actions-pr-context.mapper.js';

let tempDirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

const VALID_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173',
  appDomains: ['127.0.0.1'],
  demand: { id: 'DEM-001', title: 'Preflight', description: 'Test demand' },
  llm: { provider: 'fake', model: 'fake' },
};

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(async () => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-preflight-'));
  tempDirs.push(dir);
  return dir;
}

function createPassingGitRepo(): GitRepositoryPort {
  return {
    isShallowRepository: async () => false,
    hasRemoteBranch: async () => true,
    ensureBaseBranchAvailable: async () => undefined,
    diffPullRequest: async () => '',
  };
}

function createGitRepo(overrides: Partial<GitRepositoryPort>): GitRepositoryPort {
  return { ...createPassingGitRepo(), ...overrides };
}

function createPassingClickUpApi(): ClickUpApiPort {
  return {
    verifyReadAccess: async () => ({ ok: true, statusCode: 200 }),
  };
}

function createClickUpApi(overrides: Partial<ClickUpApiPort>): ClickUpApiPort {
  return { ...createPassingClickUpApi(), ...overrides };
}

function createPassingGitHubApi(): GitHubApiPort {
  return {
    verifyPrCommentPermission: async () => ({ ok: true, statusCode: 200 }),
  };
}

function createGitHubApi(overrides: Partial<GitHubApiPort>): GitHubApiPort {
  return { ...createPassingGitHubApi(), ...overrides };
}

function createPreflightReportWriter(): PreflightReportWriterPort {
  return new FilePreflightReportWriterAdapter();
}

function makeService(
  gitRepo: GitRepositoryPort = createPassingGitRepo(),
  clickUpApi: ClickUpApiPort = createPassingClickUpApi(),
  githubApi: GitHubApiPort = createPassingGitHubApi(),
  sanitizer: SanitizerService = new SanitizerService(),
  reportWriter: PreflightReportWriterPort = createPreflightReportWriter(),
  githubEventContext: GitHubEventContextPort = new FileGitHubEventContextAdapter(),
) {
  const configLoader = new FileConfigLoader();
  return new PipelinePreflightService(
    configLoader,
    gitRepo,
    clickUpApi,
    githubApi,
    githubEventContext,
    sanitizer,
    new ValidateConfigUseCase(configLoader),
    reportWriter,
  );
}

function setPullRequestContextEnv(): void {
  process.env.GITHUB_EVENT_NAME = 'pull_request';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_REF = 'refs/pull/42/merge';
  process.env.GITHUB_HEAD_REF = 'feature/test';
  process.env.GITHUB_BASE_REF = 'main';
}

async function writePreflightPullRequestEvent(
  payload: Record<string, unknown> = {},
): Promise<string> {
  const eventDir = await tempDir();
  const eventPath = join(eventDir, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 42,
        title: 'PRJ-11552 — Pipeline preflight test',
        user: { login: 'octocat' },
        ...payload,
      },
    }),
    'utf8',
  );
  return eventPath;
}

async function attachPullRequestEventWithTaskId(
  payload: Record<string, unknown> = {},
): Promise<void> {
  process.env.GITHUB_EVENT_PATH = await writePreflightPullRequestEvent(payload);
}

async function setFullPreflightEnv(): Promise<void> {
  process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
  process.env.GITHUB_TOKEN = 'ghp_xxx';
  setPullRequestContextEnv();
  await attachPullRequestEventWithTaskId();
}

function clearGitHubTokens(): void {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.INPUT_GITHUB_TOKEN;
}

async function writeConfigFile(dir: string, content: unknown, name = 'agent-qa.config.json'): Promise<string> {
  const configPath = join(dir, name);
  await writeFile(configPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return configPath;
}

async function attachValidConfig(): Promise<void> {
  const configDir = await tempDir();
  process.env.AGENT_QA_CONFIG = await writeConfigFile(configDir, VALID_CONFIG);
}

async function setupPreflightPassEnv(): Promise<string> {
  const dir = await tempDir();
  process.env.AGENT_QA_CONFIG = await writeConfigFile(dir, VALID_CONFIG);
  await setFullPreflightEnv();
  return dir;
}

describe('PipelinePreflightService', () => {
  it('returns PASS when all checks succeed', async () => {
    const outputDir = await setupPreflightPassEnv();
    const result = await makeService().run(outputDir);

    expect(result.report.status).toBe('PASS');
    expect(result.report.checks.clickupToken.ok).toBe(true);
    expect(result.report.checks.clickupReadAccess.ok).toBe(true);
    expect(result.report.checks.clickupReadAccess.statusCode).toBe(200);
    expect(result.report.checks.clickupTaskId.ok).toBe(true);
    expect(result.report.checks.githubToken.ok).toBe(true);
    expect(result.report.checks.prCommentPermission.ok).toBe(true);
    expect(result.report.checks.prCommentPermission.repository).toBe('owner/repo');
    expect(result.report.checks.prCommentPermission.pullNumber).toBe(42);
    expect(result.report.checks.prContext.ok).toBe(true);
    expect(result.report.checks.branchHead.ok).toBe(true);
    expect(result.report.checks.branchHead.branchHead).toBe('feature/test');
    expect(result.report.checks.checkoutHistory.ok).toBe(true);
    expect(result.report.checks.checkoutHistory.baseRef).toBe('main');
    expect(result.report.checks.checkoutHistory.shallow).toBe(false);
    expect(result.report.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when required env is missing', async () => {
    delete process.env.CLICKUP_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.INPUT_GITHUB_TOKEN;

    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.report.status).toBe('BLOCKED');
    expect(result.report.checks.clickupToken.ok).toBe(false);
    expect(result.report.checks.clickupTaskId.ok).toBe(true);
    expect(result.report.checks.clickupTaskId.skipped).toBe(true);
    expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
    expect(result.report.checks.githubToken.ok).toBe(false);
    expect(result.report.checks.githubToken.warning).toBeTruthy();
    expect(result.report.checks.config.ok).toBe(false);
  });

  it('returns BLOCKED when PR context is missing', async () => {
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    await attachValidConfig();

    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.report.status).toBe('BLOCKED');
    expect(result.report.checks.prContext.ok).toBe(false);
    expect(result.report.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
    expect(result.report.checks.prContext.missing).toContain('GITHUB_REF');
    expect(result.report.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
    expect(result.report.checks.prContext.missing).toContain('GITHUB_BASE_REF');
    expect(result.report.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when clickup env is empty strings', async () => {
    process.env.CLICKUP_TOKEN = '';
    process.env.GITHUB_TOKEN = '   ';
    setPullRequestContextEnv();
    await attachPullRequestEventWithTaskId({ title: 'Fix login without task id' });
    await attachValidConfig();

    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.report.status).toBe('BLOCKED');
    expect(result.report.checks.githubToken.ok).toBe(false);
    expect(result.report.checks.githubToken.warning).toBeTruthy();
    expect(result.report.checks.clickupToken.ok).toBe(false);
    expect(result.report.checks.clickupTaskId.ok).toBe(false);
  });

  describe('PRJ-11350 — clickupTaskId validation from PR', () => {
    async function setFullEnvExceptClickUpTaskId(): Promise<void> {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      setPullRequestContextEnv();
      await attachPullRequestEventWithTaskId({ title: 'Fix login without task id' });
      await attachValidConfig();
    }

    it('clickupTaskId check passes when PR title contains task ID', async () => {
      const outputDir = await setupPreflightPassEnv();

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.source).toBe('pr');
      expect(result.report.checks.clickupTaskId.taskId).toBe('PRJ-11552');
    });

    it('clickupTaskId check fails when PR has no task ID', async () => {
      await setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(false);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('clickupTaskId check fails when legacy env is set but PR has no task ID', async () => {
      await setFullEnvExceptClickUpTaskId();
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(false);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only ClickUp task ID is missing from PR', async () => {
      await setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.clickupTaskId.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11552 — extract ClickUp task ID from PR', () => {
    it('uses PR body fallback when title has no task ID', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_EVENT_PATH = await writePreflightPullRequestEvent({
        title: 'Fix login flow',
        body: 'Related to PRJ-11392',
      });

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.skipped).toBeUndefined();
      expect(result.report.checks.clickupTaskId.source).toBe('pr');
      expect(result.report.checks.clickupTaskId.taskId).toBe('PRJ-11392');
    });

    it('skips clickupTaskId with WARN when PR context is complete but GITHUB_EVENT_PATH is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.GITHUB_EVENT_PATH;

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.skipped).toBe(true);
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.message).toContain(
        'not running in GitHub Actions',
      );
    });

    it('extracts task ID using CLICKUP_CUSTOM_ID_PATTERN env when config has no pattern', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_CUSTOM_ID_PATTERN = 'TASK-\\d+';
      process.env.GITHUB_EVENT_PATH = await writePreflightPullRequestEvent({
        title: 'TASK-12345 — Custom pattern',
      });

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.taskId).toBe('TASK-12345');
    });

    it('prefers clickup.customIdPattern in config over CLICKUP_CUSTOM_ID_PATTERN env', async () => {
      const outputDir = await tempDir();
      process.env.AGENT_QA_CONFIG = await writeConfigFile(outputDir, {
        ...VALID_CONFIG,
        clickup: { customIdPattern: 'PRJ-\\d+' },
      });
      await setFullPreflightEnv();
      process.env.CLICKUP_CUSTOM_ID_PATTERN = 'TASK-\\d+';
      process.env.GITHUB_EVENT_PATH = await writePreflightPullRequestEvent({
        title: 'PRJ-11552 — Config pattern wins',
      });

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.taskId).toBe('PRJ-11552');
    });

    it('warns when CLICKUP_CUSTOM_ID_PATTERN is invalid but still extracts with default', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_CUSTOM_ID_PATTERN = '[PRJ-\\d+';

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.taskId).toBe('PRJ-11552');
      expect(result.report.checks.clickupTaskId.warning).toBe(
        'Invalid custom ID pattern; using default PRJ-\\d+',
      );
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.message).toContain(
        'Invalid custom ID pattern',
      );
    });

    it('warns when clickup.customIdPattern in config is invalid but still extracts with default', async () => {
      const outputDir = await tempDir();
      process.env.AGENT_QA_CONFIG = await writeConfigFile(outputDir, {
        ...VALID_CONFIG,
        clickup: { customIdPattern: '[PRJ-\\d+' },
      });
      await setFullPreflightEnv();
      delete process.env.CLICKUP_CUSTOM_ID_PATTERN;

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.taskId).toBe('PRJ-11552');
      expect(result.report.checks.clickupTaskId.warning).toBe(
        'Invalid custom ID pattern; using default PRJ-\\d+',
      );
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
    });

    it('fails clickupTaskId check when GITHUB_EVENT_PATH contains invalid JSON', async () => {
      const outputDir = await setupPreflightPassEnv();
      const dir = await tempDir();
      const eventPath = join(dir, 'invalid-event.json');
      await writeFile(eventPath, '{not-json', 'utf8');
      process.env.GITHUB_EVENT_PATH = eventPath;

      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.clickupTaskId.ok).toBe(false);
      expect(result.report.checks.clickupTaskId.error).toBe('GitHub Actions event payload is invalid');
      expect(result.report.checks.clickupTaskId.skipped).toBeUndefined();
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('FAIL');
    });

    it('sanitizes clickupTaskId extraction errors in preflight report', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_TOKEN = 'ghp_super_secret_token';
      vi.spyOn(githubPrContextMapper, 'extractClickUpTaskIdFromGitHubEvent').mockRejectedValueOnce(
        new Error('Failed reading /home/user/secret/event.json with ghp_super_secret_token'),
      );

      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupTaskId.ok).toBe(false);
      expect(result.report.checks.clickupTaskId.error).toBe(
        'Failed reading <redacted> with ***REDACTED***',
      );

      vi.restoreAllMocks();
    });
  });

  describe('PRJ-11349 — CLICKUP_TOKEN validation', () => {
    async function setFullEnvExceptClickUpToken(): Promise<void> {
      delete process.env.CLICKUP_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      setPullRequestContextEnv();
      await attachPullRequestEventWithTaskId();
      await attachValidConfig();
    }

    it('clickupToken check passes when CLICKUP_TOKEN is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupToken.ok).toBe(true);
    });

    it('clickupToken check fails when CLICKUP_TOKEN is missing', async () => {
      await setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupToken.ok).toBe(false);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('clickupToken check fails when CLICKUP_TOKEN is whitespace', async () => {
      await setFullEnvExceptClickUpToken();
      process.env.CLICKUP_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupToken.ok).toBe(false);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only CLICKUP_TOKEN is missing', async () => {
      await setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.clickupToken.ok).toBe(false);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TOKEN value', async () => {
      const secret = 'pk_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = secret;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      setPullRequestContextEnv();
      await attachPullRequestEventWithTaskId();
      await attachValidConfig();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.clickupToken.ok).toBe(true);
    });
  });

  describe('PRJ-11352 — GITHUB_TOKEN validation', () => {
    async function setFullEnvExceptGitHubToken(): Promise<void> {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      clearGitHubTokens();
      setPullRequestContextEnv();
      await attachPullRequestEventWithTaskId();
      await attachValidConfig();
    }

    it('githubToken check passes when GITHUB_TOKEN is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_TOKEN = 'ghp_live_valid_token';

      const result = await makeService().run(outputDir);

      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.githubToken.warning).toBeUndefined();
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is missing', async () => {
      await setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.githubToken.ok).toBe(false);
      expect(result.report.checks.githubToken.warning).toContain('GitHub token is missing');
    });

    it('githubToken check passes when GH_TOKEN is set and GITHUB_TOKEN is missing', async () => {
      await setFullEnvExceptGitHubToken();
      process.env.GH_TOKEN = 'ghp_from_gh_token';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.githubToken.ok).toBe(true);
    });

    it('githubToken check passes when INPUT_GITHUB_TOKEN is set', async () => {
      await setFullEnvExceptGitHubToken();
      process.env.INPUT_GITHUB_TOKEN = 'ghp_from_input';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.githubToken.ok).toBe(true);
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is whitespace', async () => {
      await setFullEnvExceptGitHubToken();
      process.env.GITHUB_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.githubToken.ok).toBe(false);
      expect(result.report.checks.githubToken.warning).toBeTruthy();
    });

    it('status remains PASS when only GITHUB_TOKEN is missing', async () => {
      await setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('PASS');
      expect(result.report.checks.githubToken.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain GITHUB_TOKEN value', async () => {
      const secret = 'ghp_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = secret;
      setPullRequestContextEnv();
      await attachPullRequestEventWithTaskId();
      await attachValidConfig();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.githubToken.ok).toBe(true);
    });
  });

  it('writes preflight-report.json to outputDir', async () => {
    const outputDir = await setupPreflightPassEnv();
    await makeService().run(outputDir);

    const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe('PASS');
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.checks).toBeDefined();
  });

  it('report includes timestamp', async () => {
    const outputDir = await setupPreflightPassEnv();
    const result = await makeService().run(outputDir);

    expect(result.report.timestamp).toBeTruthy();
    expect(new Date(result.report.timestamp).toISOString()).toBe(result.report.timestamp);
  });

  describe('PRJ-11353 — GitHub Actions PR context validation', () => {
    async function setFullEnvExceptPrContext(): Promise<void> {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      delete process.env.GITHUB_EVENT_NAME;
      delete process.env.GITHUB_REF;
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_BASE_REF;
      await attachValidConfig();
    }

    it('prContext passes when pull_request event and refs are set', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.prContext.missing).toEqual([]);
      expect(result.report.checks.prContext.eventName).toBe('pull_request');
    });

    it('prContext passes when pull_request_target event and refs are set', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_EVENT_NAME = 'pull_request_target';
      process.env.GITHUB_REF = 'refs/heads/main';

      const result = await makeService().run(outputDir);

      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.prContext.eventName).toBe('pull_request_target');
    });

    it('prContext fails when GITHUB_EVENT_NAME is missing', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_EVENT_NAME;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.prContext.ok).toBe(false);
      expect(result.report.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
      expect(result.report.status).toBe('BLOCKED');
    });

    it('prContext fails when GITHUB_EVENT_NAME is not pull_request', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      process.env.GITHUB_EVENT_NAME = 'push';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.prContext.ok).toBe(false);
      expect(result.report.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
      expect(result.report.checks.prContext.eventName).toBe('push');
      expect(result.report.status).toBe('BLOCKED');
    });

    it('prContext fails when GITHUB_HEAD_REF is missing', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_HEAD_REF;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.prContext.ok).toBe(false);
      expect(result.report.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
      expect(result.report.checks.branchHead.ok).toBe(false);
      expect(result.report.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.report.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only PR context is invalid', async () => {
      await setFullEnvExceptPrContext();
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.prContext.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.skipped).toBe(true);
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.message).toContain(
        'PR context incomplete',
      );
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11354 — project config validation', () => {
    async function setFullEnvExceptConfig(): Promise<void> {
      await setFullPreflightEnv();
      delete process.env.AGENT_QA_CONFIG;
    }

    it('config passes when file exists with required fields', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.config.ok).toBe(true);
      expect(result.report.checks.config.errors).toEqual([]);
      expect(result.report.checks.config.configPath).toBeTruthy();
    });

    it('config fails when file is missing', async () => {
      await setFullEnvExceptConfig();
      process.env.AGENT_QA_CONFIG = join(await tempDir(), 'missing.config.json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.config.ok).toBe(false);
      expect(result.report.checks.config.errors.some((e) => e.includes('Config file not found'))).toBe(true);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('config fails when file is invalid JSON', async () => {
      await setFullEnvExceptConfig();
      const configDir = await tempDir();
      process.env.AGENT_QA_CONFIG = await writeConfigFile(configDir, '{ not valid json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.config.ok).toBe(false);
      expect(result.report.checks.config.errors.length).toBeGreaterThan(0);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('config fails when required fields are missing', async () => {
      await setFullEnvExceptConfig();
      const configDir = await tempDir();
      process.env.AGENT_QA_CONFIG = await writeConfigFile(configDir, {
        baseUrl: 'http://127.0.0.1:4173',
        appDomains: ['127.0.0.1'],
      });

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.config.ok).toBe(false);
      expect(result.report.checks.config.errors.some((e) => e.includes('demand'))).toBe(true);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only config is invalid', async () => {
      await setFullPreflightEnv();
      process.env.AGENT_QA_CONFIG = join(await tempDir(), 'missing.config.json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.config.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
    });

    it('config check resolves AGENT_QA_CONFIG against GITHUB_WORKSPACE', async () => {
      const workspaceDir = await tempDir();
      const configPath = await writeConfigFile(workspaceDir, VALID_CONFIG);
      process.env.GITHUB_WORKSPACE = workspaceDir;
      process.env.AGENT_QA_CONFIG = './agent-qa.config.json';
      await setFullPreflightEnv();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.config.ok).toBe(true);
      expect(result.report.checks.config.configPath).toBe(configPath);
    });
  });

  describe('PRJ-11355 — branch head validation', () => {
    async function setFullEnvExceptBranchHead(): Promise<void> {
      setFullPreflightEnv();
      delete process.env.GITHUB_HEAD_REF;
      await attachValidConfig();
    }

    it('branchHead passes and returns branch name when GITHUB_HEAD_REF is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_HEAD_REF = 'feature/my-branch';

      const result = await makeService().run(outputDir);

      expect(result.report.checks.branchHead.ok).toBe(true);
      expect(result.report.checks.branchHead.branchHead).toBe('feature/my-branch');
      expect(result.report.checks.branchHead.missing).toEqual([]);
    });

    it('branchHead fails when GITHUB_HEAD_REF is missing', async () => {
      await setFullEnvExceptBranchHead();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.branchHead.ok).toBe(false);
      expect(result.report.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.report.checks.branchHead.branchHead).toBeUndefined();
      expect(result.report.status).toBe('BLOCKED');
    });

    it('branchHead fails when GITHUB_HEAD_REF is whitespace', async () => {
      await setFullEnvExceptBranchHead();
      process.env.GITHUB_HEAD_REF = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.branchHead.ok).toBe(false);
      expect(result.report.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.report.status).toBe('BLOCKED');
    });

    it('preflight-report.json includes branchHead value', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_HEAD_REF = 'feature/report-branch';

      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.checks.branchHead.ok).toBe(true);
      expect(parsed.checks.branchHead.branchHead).toBe('feature/report-branch');
    });

    it('status is BLOCKED when GITHUB_HEAD_REF is missing', async () => {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.GITHUB_EVENT_NAME = 'pull_request';
      process.env.GITHUB_REF = 'refs/pull/42/merge';
      process.env.GITHUB_BASE_REF = 'main';
      delete process.env.GITHUB_HEAD_REF;
      await attachValidConfig();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.branchHead.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.skipped).toBe(true);
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.status).toBe('WARN');
      expect(result.report.checkItems.find((item) => item.name === 'clickupTaskId')?.message).toContain(
        'PR context incomplete',
      );
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11356 — checkout history validation', () => {
    it('checkoutHistory passes when not shallow and base branch is accessible', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.checkoutHistory.ok).toBe(true);
      expect(result.report.checks.checkoutHistory.errors).toEqual([]);
      expect(result.report.checks.checkoutHistory.baseRef).toBe('main');
      expect(result.report.checks.checkoutHistory.shallow).toBe(false);
    });

    it('checkoutHistory fails when repository is shallow', async () => {
      const gitRepo = createGitRepo({ isShallowRepository: async () => true });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.report.checks.checkoutHistory.ok).toBe(false);
      expect(result.report.checks.checkoutHistory.shallow).toBe(true);
      expect(result.report.checks.checkoutHistory.errors.some((e) => e.includes('shallow'))).toBe(true);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('checkoutHistory fails when base branch is not accessible locally', async () => {
      const gitRepo = createGitRepo({ hasRemoteBranch: async () => false });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.report.checks.checkoutHistory.ok).toBe(false);
      expect(result.report.checks.checkoutHistory.errors.some((e) => e.includes('origin/main'))).toBe(true);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('checkoutHistory fails when GITHUB_BASE_REF is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.GITHUB_BASE_REF;

      const result = await makeService().run(outputDir);

      expect(result.report.checks.checkoutHistory.ok).toBe(false);
      expect(result.report.checks.checkoutHistory.errors).toContain('GITHUB_BASE_REF is missing');
      expect(result.report.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only checkout history is invalid', async () => {
      const gitRepo = createGitRepo({ isShallowRepository: async () => true });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.checkoutHistory.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.branchHead.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11351 — ClickUp read access validation', () => {
    it('clickupReadAccess passes when API returns 200', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.clickupReadAccess.ok).toBe(true);
      expect(result.report.checks.clickupReadAccess.statusCode).toBe(200);
      expect(result.report.checks.clickupReadAccess.error).toBeUndefined();
    });

    it('clickupReadAccess calls verifyReadAccess with CLICKUP_TOKEN', async () => {
      const token = 'pk_test_read_access_token';
      process.env.CLICKUP_TOKEN = token;
      let receivedToken = '';
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async (t) => {
          receivedToken = t;
          return { ok: true, statusCode: 200 };
        },
      });

      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = token;
      await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);

      expect(receivedToken).toBe(token);
    });

    it('clickupReadAccess fails when API returns 401', async () => {
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          statusCode: 401,
          error: 'ClickUp read access denied (401)',
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);

      expect(result.report.checks.clickupReadAccess.ok).toBe(false);
      expect(result.report.checks.clickupReadAccess.statusCode).toBe(401);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('clickupReadAccess fails when API returns 403', async () => {
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          statusCode: 403,
          error: 'ClickUp read access denied (403)',
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);

      expect(result.report.checks.clickupReadAccess.ok).toBe(false);
      expect(result.report.checks.clickupReadAccess.statusCode).toBe(403);
      expect(result.report.status).toBe('BLOCKED');
    });

    it('preflight-report.json does not contain CLICKUP_TOKEN value for read access check', async () => {
      const secret = 'pk_test_read_access_secret_98765';
      process.env.CLICKUP_TOKEN = secret;
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = secret;

      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.clickupReadAccess.ok).toBe(true);
    });

    it('status is BLOCKED when only clickup read access fails', async () => {
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          statusCode: 401,
          error: 'ClickUp read access denied (401)',
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      expect(result.report.checks.clickupReadAccess.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.branchHead.ok).toBe(true);
      expect(result.report.checks.checkoutHistory.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11357 — PR comment permission validation', () => {
    it('prCommentPermission passes when API returns 200', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checks.prCommentPermission.ok).toBe(true);
      expect(result.report.checks.prCommentPermission.statusCode).toBe(200);
      expect(result.report.checks.prCommentPermission.warning).toBeUndefined();
      expect(result.report.checks.prCommentPermission.repository).toBe('owner/repo');
      expect(result.report.checks.prCommentPermission.pullNumber).toBe(42);
    });

    it('prCommentPermission calls verifyPrCommentPermission with token and PR metadata', async () => {
      const token = 'ghp_test_pr_comment_token';
      let receivedParams: { token: string; repository: string; pullNumber: number } | undefined;
      const githubApi = createGitHubApi({
        verifyPrCommentPermission: async (params) => {
          receivedParams = params;
          return { ok: true, statusCode: 200 };
        },
      });

      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_TOKEN = token;
      process.env.GITHUB_REPOSITORY = 'mesha/qa-agent';
      process.env.GITHUB_REF = 'refs/pull/99/merge';

      await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);

      expect(receivedParams).toEqual({
        token,
        repository: 'mesha/qa-agent',
        pullNumber: 99,
      });
    });

    it('prCommentPermission fails with warning when API returns 403', async () => {
      const githubApi = createGitHubApi({
        verifyPrCommentPermission: async () => ({
          ok: false,
          statusCode: 403,
          warning: 'GitHub PR comment permission denied (403)',
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);

      expect(result.report.checks.prCommentPermission.ok).toBe(false);
      expect(result.report.checks.prCommentPermission.statusCode).toBe(403);
      expect(result.report.checks.prCommentPermission.warning).toContain('403');
    });

    it('prCommentPermission fails with warning when GITHUB_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      clearGitHubTokens();

      const result = await makeService().run(outputDir);

      expect(result.report.checks.prCommentPermission.ok).toBe(false);
      expect(result.report.checks.prCommentPermission.warning).toContain('GitHub token is missing');
    });

    it('prCommentPermission resolves PR number from GITHUB_EVENT_PATH when GITHUB_REF is base branch', async () => {
      const eventDir = await tempDir();
      const eventPath = join(eventDir, 'event.json');
      await writeFile(eventPath, JSON.stringify({ pull_request: { number: 77 } }), 'utf8');

      let receivedParams: { token: string; repository: string; pullNumber: number } | undefined;
      const githubApi = createGitHubApi({
        verifyPrCommentPermission: async (params) => {
          receivedParams = params;
          return { ok: true, statusCode: 200 };
        },
      });
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_EVENT_NAME = 'pull_request_target';
      process.env.GITHUB_REF = 'refs/heads/main';
      process.env.GITHUB_EVENT_PATH = eventPath;

      await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);

      expect(receivedParams?.pullNumber).toBe(77);
    });

    it('status remains PASS when only pr comment permission fails', async () => {
      const githubApi = createGitHubApi({
        verifyPrCommentPermission: async () => ({
          ok: false,
          statusCode: 403,
          warning: 'GitHub PR comment permission denied (403)',
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);

      expect(result.report.status).toBe('PASS');
      expect(result.report.checks.prCommentPermission.ok).toBe(false);
      expect(result.report.checks.clickupToken.ok).toBe(true);
      expect(result.report.checks.clickupReadAccess.ok).toBe(true);
      expect(result.report.checks.clickupTaskId.ok).toBe(true);
      expect(result.report.checks.githubToken.ok).toBe(true);
      expect(result.report.checks.prContext.ok).toBe(true);
      expect(result.report.checks.branchHead.ok).toBe(true);
      expect(result.report.checks.checkoutHistory.ok).toBe(true);
      expect(result.report.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain GITHUB_TOKEN value for pr comment permission check', async () => {
      const secret = 'ghp_test_pr_comment_secret_54321';
      const githubApi = createPassingGitHubApi();
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_TOKEN = secret;

      await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.prCommentPermission.ok).toBe(true);
    });
  });

  describe('PRJ-11358 — token masking in logs and reports', () => {
    it('preflight-report.json masks CLICKUP_TOKEN leaked in read access error', async () => {
      const secret = 'pk_test_read_access_leak_98765';
      process.env.CLICKUP_TOKEN = secret;
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          error: `Auth failed for token ${secret}`,
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = secret;

      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);
      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');

      expect(result.report.status).toBe('BLOCKED');
      expect(raw).not.toContain(secret);
      expect(raw).toContain('***REDACTED***');
      expect(result.report.checks.clickupReadAccess.error).toContain('***REDACTED***');
      expect(result.report.checks.clickupReadAccess.error).not.toContain(secret);
    });

    it('preflight-report.json masks Authorization Bearer header in GitHub error', async () => {
      const bearer = 'ghp_test_bearer_leak_12345678';
      const githubApi = createGitHubApi({
        verifyPrCommentPermission: async () => ({
          ok: false,
          statusCode: 401,
          warning: `Authorization: Bearer ${bearer} rejected`,
        }),
      });
      const outputDir = await setupPreflightPassEnv();

      const result = await makeService(createPassingGitRepo(), createPassingClickUpApi(), githubApi).run(outputDir);
      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');

      expect(raw).not.toContain(bearer);
      expect(raw).toContain('***REDACTED***');
      expect(result.report.checks.prCommentPermission.warning).toContain('***REDACTED***');
      expect(result.report.checks.prCommentPermission.warning).not.toContain(bearer);
    });

    it('run() return value matches sanitized preflight-report.json on disk', async () => {
      const secret = 'pk_test_return_match_secret_111';
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          error: `token ${secret} invalid`,
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = secret;

      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);
      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      const parsed = JSON.parse(raw);

      expect(result.report).toEqual(parsed);
      expect(result.reportPath).toContain('preflight-report.json');
      expect(JSON.stringify(result.report)).not.toContain(secret);
    });

    it('run() returns reportPath for persisted artifact', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.reportPath).toContain('preflight-report.json');
      const raw = await readFile(result.reportPath, 'utf8');
      expect(JSON.parse(raw).status).toBe('PASS');
    });
  });

  describe('PRJ-11359 — preflight-report.json', () => {
    it('generates preflight-report.json after run()', async () => {
      const outputDir = await setupPreflightPassEnv();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw.length).toBeGreaterThan(0);
    });

    it('PreflightReportSchema.parse passes for PASS and BLOCKED scenarios', async () => {
      const passDir = await setupPreflightPassEnv();
      await makeService().run(passDir);
      const passRaw = await readFile(join(passDir, 'preflight-report.json'), 'utf8');
      expect(PreflightReportSchema.parse(JSON.parse(passRaw)).status).toBe('PASS');

      const blockedDir = await tempDir();
      Object.keys(process.env).forEach((key) => delete process.env[key]);
      await makeService().run(blockedDir);
      const blockedRaw = await readFile(join(blockedDir, 'preflight-report.json'), 'utf8');
      expect(PreflightReportSchema.parse(JSON.parse(blockedRaw)).status).toBe('BLOCKED');
    });

    it('checkItems contains all checks with name, status and message', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.checkItems).toHaveLength(PREFLIGHT_CHECK_NAMES.length);
      expect(result.report.checkItems.map((item) => item.name)).toEqual([...PREFLIGHT_CHECK_NAMES]);
      for (const item of result.report.checkItems) {
        expect(item.status).toMatch(/^(PASS|FAIL|WARN)$/);
        expect(item.message.length).toBeGreaterThan(0);
      }
    });

    it('global status is PASS when all blocking checks pass', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('PASS');
      expect(result.report.schemaVersion).toBe('preflight-report.v1');
      expect(result.report.tokensMasked).toBe(true);
    });

    it('global status is BLOCKED when CLICKUP_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.CLICKUP_TOKEN;

      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('BLOCKED');
      const clickupTokenItem = result.report.checkItems.find((item) => item.name === 'clickupToken');
      expect(clickupTokenItem?.status).toBe('FAIL');
    });

    it('global status stays PASS when only GITHUB_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      clearGitHubTokens();

      const result = await makeService().run(outputDir);

      expect(result.report.status).toBe('PASS');
      const githubTokenItem = result.report.checkItems.find((item) => item.name === 'githubToken');
      expect(githubTokenItem?.status).toBe('WARN');
    });

    it('report includes tokensMasked and masks leaked token literals', async () => {
      const secret = 'pk_test_preflight_report_leak_999';
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          error: `Auth failed for token ${secret}`,
        }),
      });
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = secret;

      const result = await makeService(createPassingGitRepo(), clickUpApi).run(outputDir);
      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');

      expect(result.report.tokensMasked).toBe(true);
      expect(raw).not.toContain(secret);
      expect(raw).toContain('***REDACTED***');
    });

    it('tokensMasked is false when sanitized output still contains known secrets', async () => {
      const secret = 'pk_test_tokens_masked_false_secret';
      const clickUpApi = createClickUpApi({
        verifyReadAccess: async () => ({
          ok: false,
          error: `Auth failed for token ${secret}`,
        }),
      });
      const passthroughSanitizer = {
        sanitizeForOutput: <T>(input: T) => input,
        containsLeakedSecrets: (serialized: string, secrets: string[]) =>
          new SanitizerService().containsLeakedSecrets(serialized, secrets),
      } as unknown as SanitizerService;
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TOKEN = secret;

      const result = await makeService(createPassingGitRepo(), clickUpApi, createPassingGitHubApi(), passthroughSanitizer).run(outputDir);

      expect(result.report.tokensMasked).toBe(false);
      expect(JSON.stringify(result.report)).toContain(secret);
    });
  });

  describe('PRJ-11360 — interrupt execution on BLOCKED', () => {
    it('runOrThrow() resolves when all blocking checks pass', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().runOrThrow(outputDir);

      expect(result.report.status).toBe('PASS');
    });

    it('runOrThrow() throws PreflightBlockedError when CLICKUP_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.CLICKUP_TOKEN;

      await expect(makeService().runOrThrow(outputDir)).rejects.toBeInstanceOf(PreflightBlockedError);
    });

    it('preflight-report.json exists with BLOCKED status before runOrThrow throws', async () => {
      const outputDir = await tempDir();
      delete process.env.CLICKUP_TOKEN;

      await expect(makeService().runOrThrow(outputDir)).rejects.toBeInstanceOf(PreflightBlockedError);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(JSON.parse(raw).status).toBe('BLOCKED');
    });

    it('runOrThrow() resolves when only GITHUB_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      clearGitHubTokens();

      const result = await makeService().runOrThrow(outputDir);

      expect(result.report.status).toBe('PASS');
      expect(result.report.checks.githubToken.ok).toBe(false);
    });

    it('report writer persists report before runOrThrow throws', async () => {
      const write = vi.fn(async (dir: string, report: import('../src/domain/schemas/preflight-report.schema.js').PreflightReport) => {
        const path = join(dir, 'preflight-report.json');
        await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
        return path;
      });
      const outputDir = await tempDir();
      delete process.env.CLICKUP_TOKEN;

      await expect(
        makeService(createPassingGitRepo(), createPassingClickUpApi(), createPassingGitHubApi(), new SanitizerService(), { write }).runOrThrow(outputDir),
      ).rejects.toBeInstanceOf(PreflightBlockedError);

      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[1]?.status).toBe('BLOCKED');
    });
  });
});
