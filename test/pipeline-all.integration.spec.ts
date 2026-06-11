import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NestFactory } from '@nestjs/core';

import { ApplicationModule } from '../src/application/application.module.js';
import { RunPipelineAllUseCase } from '../src/application/use-cases/run-pipeline-all.usecase.js';
import { AgentService } from '../src/application/services/agent.service.js';
import { FetchClickUpApiAdapter } from '../src/infra/clickup/fetch-clickup-api.adapter.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';
import { FetchGitHubApiAdapter } from '../src/infra/github/fetch-github-api.adapter.js';
import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { GitHubActionsPrContextReaderAdapter } from '../src/infra/github/github-actions-pr-context-reader.adapter.js';
import { ScenarioSelectorService } from '../src/application/services/scenario-selector.service.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import type { PullRequestContext } from '../src/domain/schemas/pull-request-context.schema.js';
import type { ChangedFile } from '../src/domain/schemas/changed-file.schema.js';
import { ExitCodes } from '../src/interfaces/cli/exit-codes.js';
import { clearCiInjectedEnv } from './helpers/ci-env-isolation.js';

const FIXTURES_DIR = join(process.cwd(), 'test/fixtures/pipeline');
const CONFIG_PATH = join(process.cwd(), 'configs/agent-qa.fixture.config.json');

let fixtureServer: ChildProcess | undefined;
let tempDirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

async function waitForHttpOk(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Fixture server not ready at ${url}`);
}

async function tempOutputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-all-e2e-'));
  tempDirs.push(dir);
  return dir;
}

async function writeGithubEvent(title: string): Promise<string> {
  const dir = await tempOutputDir();
  const eventPath = join(dir, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 42,
        title,
        user: { login: 'octocat' },
      },
    }),
    'utf8',
  );
  return eventPath;
}

function setPullRequestContextEnv(): void {
  process.env.GITHUB_EVENT_NAME = 'pull_request';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_REF = 'refs/pull/42/merge';
  process.env.GITHUB_HEAD_REF = 'feature/test';
  process.env.GITHUB_BASE_REF = 'main';
}

async function loadPrDiffFixture(): Promise<{
  pullRequest: PullRequestContext;
  changedFiles: ChangedFile[];
  affectedRoutes: string[];
  affectedSchemas: string[];
}> {
  return JSON.parse(await readFile(join(FIXTURES_DIR, 'pr-diff-context.json'), 'utf8'));
}

async function loadDemandFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8'));
}

const E2E_SCENARIO: QaScenario = {
  id: 'SC-E2E-001',
  title: 'Fixture home loads',
  status: 'PLANNED',
  intent: 'POSITIVE',
  tasks: [
    {
      id: 'T001',
      title: 'Navegar para a página inicial',
      expected: 'Página carrega sem erros',
      status: 'PENDING',
      intent: 'POSITIVE',
    },
  ],
};

function stubExternalPortsForHappyPath(): void {
  vi.spyOn(FetchClickUpApiAdapter.prototype, 'verifyReadAccess').mockResolvedValue({
    ok: true,
    statusCode: 200,
  });
  vi.spyOn(FetchGitHubApiAdapter.prototype, 'verifyPrCommentPermission').mockResolvedValue({
    ok: true,
    statusCode: 200,
    repository: 'owner/repo',
    pullNumber: 42,
  });
  vi.spyOn(ClickUpHttpReaderAdapter.prototype, 'readConfiguredTask').mockImplementation(async () => ({
    demand: await loadDemandFixture(),
  }));
  vi.spyOn(ExecGitRepositoryAdapter.prototype, 'isShallowRepository').mockResolvedValue(false);
  vi.spyOn(ExecGitRepositoryAdapter.prototype, 'hasRemoteBranch').mockResolvedValue(true);
  vi.spyOn(ExecGitRepositoryAdapter.prototype, 'ensureBaseBranchAvailable').mockResolvedValue(undefined);
  vi.spyOn(ExecGitRepositoryAdapter.prototype, 'diffPullRequest').mockResolvedValue('diff --git a/src/routes/login.ts b/src/routes/login.ts');
  vi.spyOn(GitHubActionsPrContextReaderAdapter.prototype, 'read').mockImplementation(async () => {
    const fixture = await loadPrDiffFixture();
    return {
      pullRequest: fixture.pullRequest,
      rawDiff: 'fixture diff',
      changedFiles: fixture.changedFiles,
      affectedRoutes: fixture.affectedRoutes,
      affectedSchemas: fixture.affectedSchemas,
    };
  });
  vi.spyOn(ScenarioSelectorService.prototype, 'select').mockReturnValue({
    selectedScenarios: [E2E_SCENARIO],
    warnings: [],
    metadata: [],
  });
}

beforeAll(async () => {
  fixtureServer = spawn('node', ['test/fixtures/server.mjs'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  await waitForHttpOk('http://127.0.0.1:4173/');
}, 30_000);

afterAll(async () => {
  fixtureServer?.kill('SIGTERM');
  await new Promise((resolve) => fixtureServer?.once('exit', resolve));
});

beforeEach(() => {
  originalEnv = { ...process.env };
  clearCiInjectedEnv();
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('Pipeline all Nest integration', () => {
  it('resolves RunPipelineAllUseCase and AgentService.pipelineAll from ApplicationModule', async () => {
    const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
    try {
      const useCase = app.get(RunPipelineAllUseCase);
      const service = app.get(AgentService);

      expect(useCase).toBeInstanceOf(RunPipelineAllUseCase);
      expect(typeof useCase.execute).toBe('function');
      expect(typeof service.pipelineAll).toBe('function');
    } finally {
      await app.close();
    }
  });
});

describe('Pipeline all E2E', () => {
  it('blocks at prepare with specific CLICKUP_TOKEN reason and skips downstream steps', async () => {
    setPullRequestContextEnv();
    process.env.GITHUB_EVENT_PATH = await writeGithubEvent('PRJ-11392 — Fixture test');
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.AGENT_QA_CONFIG = CONFIG_PATH;
    delete process.env.CLICKUP_TOKEN;

    const outputDir = await tempOutputDir();
    const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
    try {
      const result = await app.get(RunPipelineAllUseCase).execute(outputDir, {
        configPath: CONFIG_PATH,
        projectPath: process.cwd(),
      });

      expect(result.exitCode).toBe(ExitCodes.PREFLIGHT_BLOCKED);
      expect(result.blockedAt).toBe('prepare');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.message).toContain('CLICKUP_TOKEN is missing');
      await expect(access(join(outputDir, 'required-scenarios.json'))).rejects.toThrow();
      await expect(access(join(outputDir, 'execution-plan.json'))).rejects.toThrow();
    } finally {
      await app.close();
    }
  });

  it(
    'runs full pipeline against fixture server with fake ClickUp HTTP reader',
    async () => {
      stubExternalPortsForHappyPath();
      process.env.CLICKUP_TOKEN = 'pk_test_token';
      process.env.GITHUB_TOKEN = 'ghp_test';
      process.env.GROQ_PROVIDER = 'fake';
      process.env.AGENT_QA_CONFIG = CONFIG_PATH;
      setPullRequestContextEnv();
      process.env.GITHUB_EVENT_PATH = await writeGithubEvent('PRJ-11392 — Improve login route');

      const outputDir = await tempOutputDir();
      const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
      try {
        const result = await app.get(RunPipelineAllUseCase).execute(outputDir, {
          configPath: CONFIG_PATH,
          projectPath: process.cwd(),
        });

        expect(result.blockedAt).toBeUndefined();
        expect(result.steps.map((step) => step.name)).toEqual([
          'prepare',
          'correlate',
          'generate-plan',
          'execute',
          'report',
          'learning',
          'promote-learning',
        ]);
        const nonOkSteps = result.steps.filter((step) => step.status !== 'OK');
        expect(nonOkSteps, JSON.stringify(result.steps, null, 2)).toEqual([]);
        expect(result.exitCode).toBe(ExitCodes.OK);

        await access(join(outputDir, 'preflight-report.json'));
        await access(join(outputDir, 'pr-diff-context.json'));
        await access(join(outputDir, 'required-scenarios.json'));
        await access(join(outputDir, 'execution-plan.json'));
        await access(join(outputDir, 'execution-result.json'));
        await access(join(outputDir, 'pipeline-report.md'));
      } finally {
        await app.close();
      }
    },
    120_000,
  );
});
