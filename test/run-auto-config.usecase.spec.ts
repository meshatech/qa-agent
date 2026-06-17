import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunAutoConfigUseCase, GENERATED_CONFIG_FILE } from '../src/application/use-cases/run-auto-config.usecase.js';
import { ConfigError } from '../src/domain/errors.js';

const prDiff = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: { prNumber: 94, baseBranch: 'release', headBranch: 'feat/x', title: 'X', author: 'dev' },
  changedFiles: [],
  affectedRoutes: [],
  affectedSchemas: [],
};

const demand = {
  taskId: 'MESHAP-1',
  title: 'T',
  description: 'D',
  acceptanceCriteria: [],
  attachments: [],
  status: 'open',
  assignees: [],
  priority: null,
  dueDate: null,
};

let outputDir: string;
let savedBaseUrl: string | undefined;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'auto-config-'));
  await writeFile(join(outputDir, 'pr-diff-context.json'), JSON.stringify(prDiff), 'utf8');
  await writeFile(join(outputDir, 'demand-context.json'), JSON.stringify(demand), 'utf8');
  savedBaseUrl = process.env.QA_AGENT_BASE_URL;
  delete process.env.QA_AGENT_BASE_URL;
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
  if (savedBaseUrl === undefined) delete process.env.QA_AGENT_BASE_URL;
  else process.env.QA_AGENT_BASE_URL = savedBaseUrl;
  vi.restoreAllMocks();
});

function makeUseCase() {
  const builtConfig = { baseUrl: 'https://app.example.com', appDomains: ['app.example.com'] };
  const builder = {
    build: vi.fn().mockResolvedValue({
      config: builtConfig,
      projectKey: { repo: 'local/project', branch: 'release' },
      knowledgeFromMemory: false,
      knowledgeAnalyzed: true,
      warnings: [],
    }),
  };
  return { useCase: new RunAutoConfigUseCase(builder as never), builder };
}

describe('RunAutoConfigUseCase', () => {
  it('reads artifacts, builds, and writes the generated config', async () => {
    const { useCase, builder } = makeUseCase();
    const result = await useCase.execute(outputDir, { previewUrl: 'https://app.example.com' });

    expect(result.configPath).toBe(join(outputDir, GENERATED_CONFIG_FILE));
    expect(builder.build).toHaveBeenCalledOnce();
    const written = JSON.parse(await readFile(result.configPath, 'utf8'));
    expect(written.baseUrl).toBe('https://app.example.com');
  });

  it('falls back to QA_AGENT_BASE_URL when --preview-url is omitted', async () => {
    process.env.QA_AGENT_BASE_URL = 'https://from-env.example.com';
    const { useCase, builder } = makeUseCase();
    await useCase.execute(outputDir, {});
    expect(builder.build).toHaveBeenCalledWith(expect.objectContaining({ previewUrl: 'https://from-env.example.com' }));
  });

  it('throws ConfigError when no preview URL is available', async () => {
    const { useCase } = makeUseCase();
    await expect(useCase.execute(outputDir, {})).rejects.toBeInstanceOf(ConfigError);
  });
});
