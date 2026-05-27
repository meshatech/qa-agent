import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineCorrelateUseCase } from '../src/application/use-cases/run-pipeline-correlate.usecase.js';
import { DemandContextPersistenceService } from '../src/application/services/demand-context-persistence.service.js';
import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';
import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import { CorrelationBlockedError, ClickUpReaderError, HarnessFatalError } from '../src/domain/errors.js';
import { CorrelationResultSchema } from '../src/domain/schemas/correlation.schema.js';
import type { ClickUpReaderPort } from '../src/application/ports/clickup-reader.port.js';
import { FileDemandContextWriterAdapter } from '../src/infra/persistence/file-demand-context-writer.adapter.js';
import { FileCorrelationArtifactsWriterAdapter } from '../src/infra/persistence/file-correlation-artifacts-writer.adapter.js';

const FIXTURES_DIR = join(process.cwd(), 'test/fixtures/pipeline');
let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.unstubAllEnvs();
});

describe('RunPipelineCorrelateUseCase', () => {
  it('writes required-scenarios.json and correlation-report.md on success', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const clickUpReader: ClickUpReaderPort = {
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({
        demand: JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8')),
      })),
    };

    const useCase = buildUseCase(clickUpReader);
    const result = await useCase.execute(outputDir, {
      projectPath: process.cwd(),
      env: process.env,
    });

    expect(result.result.status).toBe('OK');
    expect(result.requiredScenariosPath.endsWith('required-scenarios.json')).toBe(true);
    expect(result.correlationReportPath.endsWith('correlation-report.md')).toBe(true);
    expect(result.demandContextPath.endsWith('demand-context.json')).toBe(true);

    const written = CorrelationResultSchema.parse(
      JSON.parse(await readFile(result.requiredScenariosPath, 'utf8')),
    );
    expect(written.scenarios.length).toBeGreaterThan(0);
    const report = await readFile(result.correlationReportPath, 'utf8');
    expect(report).toContain('# Correlation Report');
  });

  it('throws CorrelationBlockedError when clickUpTaskId is missing', async () => {
    const outputDir = await prepareOutputDir({ omitClickUpTaskId: true });
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    await expect(useCase.execute(outputDir)).rejects.toBeInstanceOf(CorrelationBlockedError);
    const scenarios = JSON.parse(await readFile(join(outputDir, 'required-scenarios.json'), 'utf8'));
    expect(scenarios.status).toBe('BLOCKED');
  });

  it('throws CorrelationBlockedError when CLICKUP_TOKEN is missing', async () => {
    const outputDir = await prepareOutputDir();
    delete process.env.CLICKUP_TOKEN;

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    await expect(useCase.execute(outputDir, { env: process.env })).rejects.toBeInstanceOf(
      CorrelationBlockedError,
    );
  });

  it('throws CorrelationBlockedError when pr-diff-context.json is missing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
    tempDirs.push(outputDir);
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    await expect(useCase.execute(outputDir)).rejects.toBeInstanceOf(CorrelationBlockedError);

    const scenarios = JSON.parse(await readFile(join(outputDir, 'required-scenarios.json'), 'utf8'));
    expect(scenarios.status).toBe('BLOCKED');
    expect(scenarios.blockReason).toContain('not found');

    const report = await readFile(join(outputDir, 'correlation-report.md'), 'utf8');
    expect(report).not.toContain('PR: #');
  });

  it('throws CorrelationBlockedError when ClickUp fetch fails', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw new ClickUpReaderError('TASK_NOT_FOUND');
      }),
    });

    await expect(useCase.execute(outputDir)).rejects.toBeInstanceOf(CorrelationBlockedError);

    const scenarios = JSON.parse(await readFile(join(outputDir, 'required-scenarios.json'), 'utf8'));
    expect(scenarios.status).toBe('BLOCKED');
    expect(scenarios.blockReason).toContain('Failed to fetch demand from ClickUp');
  });

  it('throws HarnessFatalError for infrastructure failures during demand persistence', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw new Error('disk write failed');
      }),
    });

    await expect(useCase.execute(outputDir)).rejects.toBeInstanceOf(HarnessFatalError);
  });
});

function buildUseCase(clickUpReader: ClickUpReaderPort): RunPipelineCorrelateUseCase {
  const loader = new MemoryMarkdownLoader();
  const memorySearch = new MemorySearchService(new MemoryChunker(loader), new BM25MemoryIndex(), loader);
  const demandPersistence = new DemandContextPersistenceService(
    new FileDemandContextWriterAdapter(),
    clickUpReader,
    new SanitizerService(),
  );

  return new RunPipelineCorrelateUseCase(
    demandPersistence,
    new DemandDiffMemoryCorrelatorService(),
    memorySearch,
    new FileCorrelationArtifactsWriterAdapter(),
  );
}

async function prepareOutputDir(options?: { omitClickUpTaskId?: boolean }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
  tempDirs.push(dir);
  const prDiff = JSON.parse(await readFile(join(FIXTURES_DIR, 'pr-diff-context.json'), 'utf8'));
  if (options?.omitClickUpTaskId) {
    delete prDiff.pullRequest.clickUpTaskId;
  }
  await writeFile(join(dir, 'pr-diff-context.json'), JSON.stringify(prDiff, null, 2), 'utf8');
  return dir;
}
