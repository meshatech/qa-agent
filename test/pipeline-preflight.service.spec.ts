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

describe('PipelinePreflightService', () => {
  it('returns PASS when all checks succeed', async () => {
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.CLICKUP_TASK_ID = '12345';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF_NAME = 'feature/test';
    process.env.GITHUB_SHA = 'abc123';

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('PASS');
    expect(result.checks.clickupToken.ok).toBe(true);
    expect(result.checks.secrets.ok).toBe(true);
    expect(result.checks.prContext.ok).toBe(true);
    expect(result.checks.config.ok).toBe(true);
  });

  it('returns BLOCKED when secrets are missing', async () => {
    // No secrets set
    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.clickupToken.ok).toBe(false);
    expect(result.checks.secrets.ok).toBe(false);
    expect(result.checks.secrets.missing).toContain('GITHUB_TOKEN');
    expect(result.checks.secrets.missing).toContain('CLICKUP_TASK_ID');
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
    expect(result.checks.prContext.missing).toContain('GITHUB_REPOSITORY');
    expect(result.checks.prContext.missing).toContain('GITHUB_REF_NAME');
    expect(result.checks.prContext.missing).toContain('GITHUB_SHA');
  });

  it('returns BLOCKED when secrets are empty strings', async () => {
    process.env.CLICKUP_TOKEN = '';
    process.env.GITHUB_TOKEN = '   ';
    process.env.CLICKUP_TASK_ID = '';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF_NAME = 'feature/test';
    process.env.GITHUB_SHA = 'abc123';

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.status).toBe('BLOCKED');
    expect(result.checks.secrets.ok).toBe(false);
    expect(result.checks.clickupToken.ok).toBe(false);
  });

  describe('PRJ-11349 — CLICKUP_TOKEN validation', () => {
    function setFullEnvExceptClickUpToken(): void {
      delete process.env.CLICKUP_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_REF_NAME = 'feature/test';
      process.env.GITHUB_SHA = 'abc123';
    }

    it('clickupToken check passes when CLICKUP_TOKEN is set', async () => {
      process.env.CLICKUP_TOKEN = 'pk_live_valid_token';
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_REF_NAME = 'feature/test';
      process.env.GITHUB_SHA = 'abc123';

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
      expect(result.checks.secrets.ok).toBe(true);
      expect(result.checks.prContext.ok).toBe(true);
    });

    it('preflight-report.json does not contain CLICKUP_TOKEN value', async () => {
      const secret = 'pk_test_super_secret_12345';
      process.env.CLICKUP_TOKEN = secret;
      process.env.GITHUB_TOKEN = 'ghp_xxx';
      process.env.CLICKUP_TASK_ID = '12345';
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_REF_NAME = 'feature/test';
      process.env.GITHUB_SHA = 'abc123';

      const outputDir = await tempDir();
      await makeService().run(outputDir);

      const raw = await readFile(join(outputDir, 'preflight-report.json'), 'utf8');
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).checks.clickupToken.ok).toBe(true);
    });
  });

  it('writes preflight-report.json to outputDir', async () => {
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.CLICKUP_TASK_ID = '12345';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF_NAME = 'feature/test';
    process.env.GITHUB_SHA = 'abc123';

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
    process.env.CLICKUP_TOKEN = 'token';
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.CLICKUP_TASK_ID = '12345';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF_NAME = 'feature/test';
    process.env.GITHUB_SHA = 'abc123';

    const outputDir = await tempDir();
    const service = makeService();
    const result = await service.run(outputDir);

    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
