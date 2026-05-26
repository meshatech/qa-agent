import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelinePreflightService } from '../src/application/services/pipeline-preflight.service.js';

let tempDirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

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
  return new PipelinePreflightService();
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

describe('PipelinePreflightService', () => {
  it('returns PASS when all checks succeed', async () => {
    setFullPreflightEnv();

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('PASS');
    expect(result.checks.clickupToken.ok).toBe(true);
    expect(result.checks.clickupTaskId.ok).toBe(true);
    expect(result.checks.githubToken.ok).toBe(true);
    expect(result.checks.prContext.ok).toBe(true);
    expect(result.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when required env is missing', async () => {
    // No env set
    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.clickupToken.ok).toBe(false);
    expect(result.checks.clickupTaskId.ok).toBe(false);
    expect(result.checks.githubToken.ok).toBe(false);
    expect(result.checks.githubToken.warning).toBeTruthy();
  });

  it('returns BLOCKED when PR context is missing', async () => {
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.CLICKUP_TASK_ID = '12345';
    // No PR context

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.prContext.ok).toBe(false);
    expect(result.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
    expect(result.checks.prContext.missing).toContain('GITHUB_REF');
    expect(result.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
    expect(result.checks.prContext.missing).toContain('GITHUB_BASE_REF');
  });

  it('returns BLOCKED when clickup env is empty strings', async () => {
    process.env.CLICKUP_TOKEN = '';
    process.env.GITHUB_TOKEN = '   ';
    process.env.CLICKUP_TASK_ID = '';
    setPullRequestContextEnv();

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.githubToken.ok).toBe(false);
    expect(result.checks.githubToken.warning).toBeTruthy();
    expect(result.checks.clickupToken.ok).toBe(false);
    expect(result.checks.clickupTaskId.ok).toBe(false);
  });

  describe('PRJ-11350 — CLICKUP_TASK_ID validation', () => {
    function setFullEnvExceptClickUpTaskId(): void {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      delete process.env.CLICKUP_TASK_ID;
      setPullRequestContextEnv();
    }

    it('clickupTaskId check passes when CLICKUP_TASK_ID is set', async () => {
      setFullPreflightEnv();
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(true);
    });

    it('clickupTaskId check fails when CLICKUP_TASK_ID is missing', async () => {
      setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('clickupTaskId check fails when CLICKUP_TASK_ID is whitespace', async () => {
      setFullEnvExceptClickUpTaskId();
      process.env.CLICKUP_TASK_ID = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only CLICKUP_TASK_ID is missing', async () => {
      setFullEnvExceptClickUpTaskId();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.clickupTaskId.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TASK_ID value', async () => {
      const taskId = '86ahmgfc0_secret_task_id';
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = taskId;
      setPullRequestContextEnv();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(taskId);
      expect(JSON.parse(raw).checks.clickupTaskId.ok).toBe(true);
    });
  });

  describe('PRJ-11349 — CLICKUP_TOKEN validation', () => {
    function setFullEnvExceptClickUpToken(): void {
      delete process.env.CLICKUP_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      setPullRequestContextEnv();
    }

    it('clickupToken check passes when CLICKUP_TOKEN is set', async () => {
      setFullPreflightEnv();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(true);
    });

    it('clickupToken check fails when CLICKUP_TOKEN is missing', async () => {
      setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('clickupToken check fails when CLICKUP_TOKEN is whitespace', async () => {
      setFullEnvExceptClickUpToken();
      process.env.CLICKUP_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only CLICKUP_TOKEN is missing', async () => {
      setFullEnvExceptClickUpToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.clickupToken.ok).toBe(false);
      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TOKEN value', async () => {
      const secret = 'pk_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = secret;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      setPullRequestContextEnv();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.clickupToken.ok).toBe(true);
    });
  });

  describe('PRJ-11352 — GITHUB_TOKEN validation', () => {
    function setFullEnvExceptGitHubToken(): void {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      delete process.env.GITHUB_TOKEN;
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      setPullRequestContextEnv();
    }

    it('githubToken check passes when GITHUB_TOKEN is set', async () => {
      setFullPreflightEnv();
      process.env.GITHUB_TOKEN = 'ghp_live_valid_token';
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(true);
      expect(result.checks.githubToken.warning).toBeUndefined();
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is missing', async () => {
      setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.githubToken.warning).toContain('GITHUB_TOKEN is missing');
    });

    it('githubToken check fails with warning when GITHUB_TOKEN is whitespace', async () => {
      setFullEnvExceptGitHubToken();
      process.env.GITHUB_TOKEN = '   ';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.githubToken.warning).toBeTruthy();
    });

    it('status remains PASS when only GITHUB_TOKEN is missing', async () => {
      setFullEnvExceptGitHubToken();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('PASS');
      expect(result.checks.githubToken.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
    });

    it('preflight-report.json does not contain GITHUB_TOKEN value', async () => {
      const secret = 'ghp_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = secret;
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      setPullRequestContextEnv();

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.githubToken.ok).toBe(true);
    });
  });

  it('writes preflight-report.json to outputDir', async () => {
    setFullPreflightEnv();

    const outputDir = await tempDir();
    const service = makeService();
    await service.run(outputDir);

    const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe('PASS');
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.checks).toBeDefined();
  });

  it('report includes timestamp', async () => {
    setFullPreflightEnv();

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  describe('PRJ-11353 — GitHub Actions PR context validation', () => {
    function setFullEnvExceptPrContext(): void {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '86ahmgfc0';
      delete process.env.GITHUB_EVENT_NAME;
      delete process.env.GITHUB_REF;
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_BASE_REF;
    }

    it('prContext passes when pull_request event and refs are set', async () => {
      setFullPreflightEnv();

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(true);
      expect(result.checks.prContext.missing).toEqual([]);
      expect(result.checks.prContext.eventName).toBe('pull_request');
    });

    it('prContext fails when GITHUB_EVENT_NAME is missing', async () => {
      setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_EVENT_NAME;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.prContext.missing).toContain('GITHUB_EVENT_NAME');
      expect(result.status).toBe('BLOCKED');
    });

    it('prContext fails when GITHUB_EVENT_NAME is not pull_request', async () => {
      setFullEnvExceptPrContext();
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
      setFullEnvExceptPrContext();
      setPullRequestContextEnv();
      delete process.env.GITHUB_HEAD_REF;

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.prContext.missing).toContain('GITHUB_HEAD_REF');
      expect(result.status).toBe('BLOCKED');
    });

    it('status is BLOCKED when only PR context is invalid', async () => {
      setFullEnvExceptPrContext();
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';

      const outputDir = await tempDir();
      const result = await makeService().run(outputDir);

      expect(result.status).toBe('BLOCKED');
      expect(result.checks.prContext.ok).toBe(false);
      expect(result.checks.clickupToken.ok).toBe(true);
      expect(result.checks.clickupTaskId.ok).toBe(true);
      expect(result.checks.githubToken.ok).toBe(true);
    });
  });
});
