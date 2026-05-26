import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelinePreflightService } from '../src/application/services/pipeline-preflight.service.js';
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

function makeService() {
  return new PipelinePreflightService(new FileConfigLoader());
}

function setPullRequestContextEnv(): void {
  process.env.GITHUB_EVENT_NAME = 'pull_request';
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
    expect(result.checks.clickupTaskId.ok).toBe(true);
    expect(result.checks.githubToken.ok).toBe(true);
    expect(result.checks.prContext.ok).toBe(true);
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
});
