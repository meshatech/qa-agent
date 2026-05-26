import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelinePreflightService } from '../src/application/services/pipeline-preflight.service.js';
import type { ClickUpApiPort } from '../src/application/ports/clickup-api.port.js';
import type { GitHubApiPort } from '../src/application/ports/github-api.port.js';
import type { GitRepositoryPort } from '../src/application/ports/git-repository.port.js';
import { FileConfigLoader } from '../src/infra/config/file-config.loader.js';

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

function makeService(
  gitRepo: GitRepositoryPort = createPassingGitRepo(),
  clickUpApi: ClickUpApiPort = createPassingClickUpApi(),
  githubApi: GitHubApiPort = createPassingGitHubApi(),
) {
  return new PipelinePreflightService(new FileConfigLoader(), gitRepo, clickUpApi, githubApi);
}

function setPullRequestContextEnv(): void {
  process.env.GITHUB_EVENT_NAME = 'pull_request';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_REF = 'refs/pull/42/merge';
  process.env.GITHUB_HEAD_REF = 'feature/test';
  process.env.GITHUB_BASE_REF = 'main';
}

function setFullPreflightEnv(): void {
  process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
  process.env.GITHUB_TOKEN = 'ghp_xxx';
  process.env.CLICKUP_TASK_ID = '12345';
  setPullRequestContextEnv();
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
  setFullPreflightEnv();
  return dir;
}

describe('PipelinePreflightService', () => {
  it('returns PASS when all checks succeed', async () => {
    const outputDir = await setupPreflightPassEnv();
    const result = await makeService().run(outputDir);

    expect(result.status).toBe('PASS');
    expect(result.checks.clickupToken.ok).toBe(true);
    expect(result.checks.clickupReadAccess.ok).toBe(true);
    expect(result.checks.clickupReadAccess.statusCode).toBe(200);
    expect(result.checks.clickupTaskId.ok).toBe(true);
    expect(result.checks.githubToken.ok).toBe(true);
    expect(result.checks.prCommentPermission.ok).toBe(true);
    expect(result.checks.prCommentPermission.repository).toBe('owner/repo');
    expect(result.checks.prCommentPermission.pullNumber).toBe(42);
    expect(result.checks.prContext.ok).toBe(true);
    expect(result.checks.branchHead.ok).toBe(true);
    expect(result.checks.branchHead.branchHead).toBe('feature/test');
    expect(result.checks.checkoutHistory.ok).toBe(true);
    expect(result.checks.checkoutHistory.baseRef).toBe('main');
    expect(result.checks.checkoutHistory.shallow).toBe(false);
    expect(result.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when required env is missing', async () => {
    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.clickupToken.ok).toBe(false);
    expect(result.checks.clickupTaskId.ok).toBe(false);
    expect(result.checks.githubToken.ok).toBe(false);
    expect(result.checks.githubToken.warning).toBeTruthy();
    expect(result.checks.config.ok).toBe(false);
  });

  it('returns BLOCKED when PR context is missing', async () => {
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.CLICKUP_TASK_ID = '12345';
    await attachValidConfig();

    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.prContext.ok).toBe(false);
    expect(result.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
    expect(result.checks.prContext.missing).toContain('GITHUB_REF');
    expect(result.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
    expect(result.checks.prContext.missing).toContain('GITHUB_BASE_REF');
    expect(result.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when clickup env is empty strings', async () => {
    process.env.CLICKUP_TOKEN = '';
    process.env.GITHUB_TOKEN = '   ';
    process.env.CLICKUP_TASK_ID = '';
    setPullRequestContextEnv();
    await attachValidConfig();

    const outputDir = await tempDir();
    const result = await makeService().run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.githubToken.ok).toBe(false);
    expect(result.checks.githubToken.warning).toBeTruthy();
    expect(result.checks.clickupToken.ok).toBe(false);
    expect(result.checks.clickupTaskId.ok).toBe(false);
  });

  describe('PRJ-11350 — CLICKUP_TASK_ID validation', () => {
    async function setFullEnvExceptClickUpTaskId(): Promise<void> {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      delete process.env.CLICKUP_TASK_ID;
      setPullRequestContextEnv();
      await attachValidConfig();
    }

    it('clickupTaskId check passes when CLICKUP_TASK_ID is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';

      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(true);
    });

    it('clickupTaskId check fails when CLICKUP_TASK_ID is missing', async () => {
      await setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('clickupTaskId check fails when CLICKUP_TASK_ID is whitespace', async () => {
      await setFullEnvExceptClickUpTaskId();
      process.env.CLICKUP_TASK_ID = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only CLICKUP_TASK_ID is missing', async () => {
      await setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TASK_ID value', async () => {
      const taskId = '86ahmgfc0_secret_task_id';
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = taskId;
      setPullRequestContextEnv();
      await attachValidConfig();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(taskId);
      expect(JSON.parse(raw).checks.clickupTaskId.ok).toBe(true);
    });
  });

  describe('PRJ-11349 — CLICKUP_TOKEN validation', () => {
    async function setFullEnvExceptClickUpToken(): Promise<void> {
      delete process.env.CLICKUP_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      setPullRequestContextEnv();
      await attachValidConfig();
    }

    it('clickupToken check passes when CLICKUP_TOKEN is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(true);
    });

    it('clickupToken check fails when CLICKUP_TOKEN is missing', async () => {
      await setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('clickupToken check fails when CLICKUP_TOKEN is whitespace', async () => {
      await setFullEnvExceptClickUpToken();
      process.env.CLICKUP_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only CLICKUP_TOKEN is missing', async () => {
      await setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TOKEN value', async () => {
      const secret = 'pk_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = secret;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      setPullRequestContextEnv();
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
      delete process.env.GITHUB_TOKEN;
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      setPullRequestContextEnv();
      await attachValidConfig();
    }

    it('githubToken check passes when GITHUB_TOKEN is set', async () => {
      const outputDir = await setupPreflightPassEnv();
      process.env.GITHUB_TOKEN = 'ghp_live_valid_token';
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';

      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.githubToken.warning).toBeUndefined();
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is missing', async () => {
      await setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.githubToken.warning).toContain('GITHUB_TOKEN is missing');
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is whitespace', async () => {
      await setFullEnvExceptGitHubToken();
      process.env.GITHUB_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.githubToken.warning).toBeTruthy();
    });

    it('status remains PASS when only GITHUB_TOKEN is missing', async () => {
      await setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('PASS');
      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });

    it('preflight-report.json does not contain GITHUB_TOKEN value', async () => {
      const secret = 'ghp_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = secret;
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      setPullRequestContextEnv();
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

    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  describe('PRJ-11353 — GitHub Actions PR context validation', () => {
    async function setFullEnvExceptPrContext(): Promise<void> {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      delete process.env.GITHUB_EVENT_NAME;
      delete process.env.GITHUB_REF;
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_BASE_REF;
      await attachValidConfig();
    }

    it('prContext passes when pull_request event and refs are set', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.prContext.missing).toEqual([]);
      expect(result.checks.prContext.eventName).toBe('pull_request');
    });

    it('prContext fails when GITHUB_EVENT_NAME is missing', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_EVENT_NAME;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
      expect(result.status).toBe('BLOCKED');
    });

    it('prContext fails when GITHUB_EVENT_NAME is not pull_request', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      process.env.GITHUB_EVENT_NAME = 'push';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
      expect(result.checks.prContext.eventName).toBe('push');
      expect(result.status).toBe('BLOCKED');
    });

    it('prContext fails when GITHUB_HEAD_REF is missing', async () => {
      await setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_HEAD_REF;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
      expect(result.checks.branchHead.ok).toBe(false);
      expect(result.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only PR context is invalid', async () => {
      await setFullEnvExceptPrContext();
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11354 — project config validation', () => {
    async function setFullEnvExceptConfig(): Promise<void> {
      setFullPreflightEnv();
      delete process.env.AGENT_QA_CONFIG;
    }

    it('config passes when file exists with required fields', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.config.ok).toBe(true);
      expect(result.checks.config.errors).toEqual([]);
      expect(result.checks.config.configPath).toBeTruthy();
    });

    it('config fails when file is missing', async () => {
      await setFullEnvExceptConfig();
      process.env.AGENT_QA_CONFIG = join(await tempDir(), 'missing.config.json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.config.ok).toBe(false);
      expect(result.checks.config.errors.some((e) => e.includes('Config file not found'))).toBe(true);
      expect(result.status).toBe('BLOCKED');
    });

    it('config fails when file is invalid JSON', async () => {
      await setFullEnvExceptConfig();
      const configDir = await tempDir();
      process.env.AGENT_QA_CONFIG = await writeConfigFile(configDir, '{ not valid json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.config.ok).toBe(false);
      expect(result.checks.config.errors.length).toBeGreaterThan(0);
      expect(result.status).toBe('BLOCKED');
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

      expect(result.checks.config.ok).toBe(false);
      expect(result.checks.config.errors.some((e) => e.includes('demand'))).toBe(true);
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only config is invalid', async () => {
      setFullPreflightEnv();
      process.env.AGENT_QA_CONFIG = join(await tempDir(), 'missing.config.json');

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.config.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
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

      expect(result.checks.branchHead.ok).toBe(true);
      expect(result.checks.branchHead.branchHead).toBe('feature/my-branch');
      expect(result.checks.branchHead.missing).toEqual([]);
    });

    it('branchHead fails when GITHUB_HEAD_REF is missing', async () => {
      await setFullEnvExceptBranchHead();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.branchHead.ok).toBe(false);
      expect(result.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.checks.branchHead.branchHead).toBeUndefined();
      expect(result.status).toBe('BLOCKED');
    });

    it('branchHead fails when GITHUB_HEAD_REF is whitespace', async () => {
      await setFullEnvExceptBranchHead();
      process.env.GITHUB_HEAD_REF = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.branchHead.ok).toBe(false);
      expect(result.checks.branchHead.missing).toContain('GITHUB_HEAD_REF');
      expect(result.status).toBe('BLOCKED');
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
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      process.env.GITHUB_EVENT_NAME = 'pull_request';
      process.env.GITHUB_REF = 'refs/pull/42/merge';
      process.env.GITHUB_BASE_REF = 'main';
      delete process.env.GITHUB_HEAD_REF;
      await attachValidConfig();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.branchHead.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11356 — checkout history validation', () => {
    it('checkoutHistory passes when not shallow and base branch is accessible', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.checkoutHistory.ok).toBe(true);
      expect(result.checks.checkoutHistory.errors).toEqual([]);
      expect(result.checks.checkoutHistory.baseRef).toBe('main');
      expect(result.checks.checkoutHistory.shallow).toBe(false);
    });

    it('checkoutHistory fails when repository is shallow', async () => {
      const gitRepo = createGitRepo({ isShallowRepository: async () => true });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.checks.checkoutHistory.ok).toBe(false);
      expect(result.checks.checkoutHistory.shallow).toBe(true);
      expect(result.checks.checkoutHistory.errors.some((e) => e.includes('shallow'))).toBe(true);
      expect(result.status).toBe('BLOCKED');
    });

    it('checkoutHistory fails when base branch is not accessible locally', async () => {
      const gitRepo = createGitRepo({ hasRemoteBranch: async () => false });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.checks.checkoutHistory.ok).toBe(false);
      expect(result.checks.checkoutHistory.errors.some((e) => e.includes('origin/main'))).toBe(true);
      expect(result.status).toBe('BLOCKED');
    });

    it('checkoutHistory fails when GITHUB_BASE_REF is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.GITHUB_BASE_REF;

      const result = await makeService().run(outputDir);

      expect(result.checks.checkoutHistory.ok).toBe(false);
      expect(result.checks.checkoutHistory.errors).toContain('GITHUB_BASE_REF is missing');
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only checkout history is invalid', async () => {
      const gitRepo = createGitRepo({ isShallowRepository: async () => true });
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService(gitRepo).run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.checkoutHistory.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.branchHead.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11351 — ClickUp read access validation', () => {
    it('clickupReadAccess passes when API returns 200', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupReadAccess.ok).toBe(true);
      expect(result.checks.clickupReadAccess.statusCode).toBe(200);
      expect(result.checks.clickupReadAccess.error).toBeUndefined();
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

      expect(result.checks.clickupReadAccess.ok).toBe(false);
      expect(result.checks.clickupReadAccess.statusCode).toBe(401);
      expect(result.status).toBe('BLOCKED');
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

      expect(result.checks.clickupReadAccess.ok).toBe(false);
      expect(result.checks.clickupReadAccess.statusCode).toBe(403);
      expect(result.status).toBe('BLOCKED');
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

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.clickupReadAccess.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.branchHead.ok).toBe(true);
      expect(result.checks.checkoutHistory.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
    });
  });

  describe('PRJ-11357 — PR comment permission validation', () => {
    it('prCommentPermission passes when API returns 200', async () => {
      const outputDir = await setupPreflightPassEnv();
      const result = await makeService().run(outputDir);

      expect(result.checks.prCommentPermission.ok).toBe(true);
      expect(result.checks.prCommentPermission.statusCode).toBe(200);
      expect(result.checks.prCommentPermission.warning).toBeUndefined();
      expect(result.checks.prCommentPermission.repository).toBe('owner/repo');
      expect(result.checks.prCommentPermission.pullNumber).toBe(42);
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

      expect(result.checks.prCommentPermission.ok).toBe(false);
      expect(result.checks.prCommentPermission.statusCode).toBe(403);
      expect(result.checks.prCommentPermission.warning).toContain('403');
    });

    it('prCommentPermission fails with warning when GITHUB_TOKEN is missing', async () => {
      const outputDir = await setupPreflightPassEnv();
      delete process.env.GITHUB_TOKEN;

      const result = await makeService().run(outputDir);

      expect(result.checks.prCommentPermission.ok).toBe(false);
      expect(result.checks.prCommentPermission.warning).toContain('GITHUB_TOKEN is missing');
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

      expect(result.status).toBe('PASS');
      expect(result.checks.prCommentPermission.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupReadAccess.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.branchHead.ok).toBe(true);
      expect(result.checks.checkoutHistory.ok).toBe(true);
      expect(result.checks.config.ok).toBe(true);
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
});
