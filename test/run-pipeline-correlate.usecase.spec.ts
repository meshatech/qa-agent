import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RunPipelineCorrelateUseCase } from '../src/application/use-cases/run-pipeline-correlate.usecase.js';
import * as readPipelineArtifactModule from '../src/application/helpers/read-pipeline-artifact.js';
import { DemandContextPersistenceService } from '../src/application/services/demand-context-persistence.service.js';
import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { MemorySearchService } from '../src/application/services/memory-search.service.js';
import { ScenarioSelectorService } from '../src/application/services/scenario-selector.service.js';
import { BM25MemoryIndex } from '../src/application/services/bm25-memory-index.service.js';
import { MemoryChunker } from '../src/application/services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import { CorrelationBlockedError, ClickUpReaderError, ConfigError, HarnessFatalError } from '../src/domain/errors.js';
import { CorrelationResultSchema, createBlockedCorrelationResult } from '../src/domain/schemas/correlation.schema.js';
import type { ClickUpReaderPort } from '../src/application/ports/clickup-reader.port.js';
import { FileDemandContextWriterAdapter } from '../src/infra/persistence/file-demand-context-writer.adapter.js';
import { FileCorrelationArtifactsWriterAdapter } from '../src/infra/persistence/file-correlation-artifacts-writer.adapter.js';

const FIXTURES_DIR = join(process.cwd(), 'test/fixtures/pipeline');
let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

    try {
      await useCase.execute(outputDir);
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.status).toBe('BLOCKED');
        expect(blocked.result.blockReason).toContain('clickUpTaskId');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('throws CorrelationBlockedError when CLICKUP_TOKEN is missing', async () => {
    const outputDir = await prepareOutputDir();
    delete process.env.CLICKUP_TOKEN;

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    try {
      await useCase.execute(outputDir, { env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.status).toBe('BLOCKED');
        expect(blocked.result.blockReason).toContain('CLICKUP_TOKEN');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('throws CorrelationBlockedError when pr-diff-context.json is missing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
    tempDirs.push(outputDir);
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    try {
      await useCase.execute(outputDir);
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.status).toBe('BLOCKED');
        expect(blocked.result.blockReason).toContain('not found');
        expect(blocked.requiredScenariosPath).toBeUndefined();
        expect(blocked.correlationReportPath).toBeUndefined();
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('throws CorrelationBlockedError with Zod details when pr-diff-context.json fails schema validation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
    tempDirs.push(outputDir);
    await writeFile(join(outputDir, 'pr-diff-context.json'), JSON.stringify({}), 'utf8');
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    try {
      await useCase.execute(outputDir);
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Pipeline artifact validation failed');
        expect(blocked.result.blockReason).toContain('schemaVersion');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('throws CorrelationBlockedError with parse details when pr-diff-context.json has invalid JSON', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
    tempDirs.push(outputDir);
    await writeFile(join(outputDir, 'pr-diff-context.json'), '{ broken', 'utf8');
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    try {
      await useCase.execute(outputDir);
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Pipeline artifact invalid JSON');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('redacts CLICKUP_TOKEN from artifact validation blockReason when token appears in error message', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'agent-qa-pipeline-correlate-'));
    tempDirs.push(outputDir);
    const secretToken = 'pk_leaked_secret_token_value';
    vi.stubEnv('CLICKUP_TOKEN', secretToken);

    vi.spyOn(readPipelineArtifactModule, 'readPipelineArtifact').mockRejectedValue(
      new ConfigError(
        'Pipeline artifact validation failed: pr-diff-context.json',
        new Error(`Invalid token ${secretToken} in artifact metadata`),
      ),
    );

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(),
    });

    try {
      await useCase.execute(outputDir, { env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Pipeline artifact validation failed');
        expect(blocked.result.blockReason).not.toContain(secretToken);
        expect(blocked.result.blockReason).toContain('***REDACTED***');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
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

    try {
      await useCase.execute(outputDir);
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Failed to fetch demand from ClickUp');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('redacts CLICKUP_TOKEN from ClickUp blockReason when token appears in error message', async () => {
    const outputDir = await prepareOutputDir();
    const secretToken = 'pk_leaked_secret_token_value';
    vi.stubEnv('CLICKUP_TOKEN', secretToken);

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw new ClickUpReaderError(`Authorization failed for ${secretToken}`);
      }),
    });

    try {
      await useCase.execute(outputDir, { env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).not.toContain(secretToken);
        expect(blocked.result.blockReason).toContain('***REDACTED***');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('redacts CLICKUP_TOKEN from HarnessFatalError when token appears in error message', async () => {
    const outputDir = await prepareOutputDir();
    const secretToken = 'pk_leaked_secret_token_value';
    vi.stubEnv('CLICKUP_TOKEN', secretToken);

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw new Error(`disk write failed with ${secretToken}`);
      }),
    });

    try {
      await useCase.execute(outputDir, { env: process.env });
      expect.fail('expected HarnessFatalError');
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessFatalError);
      expect((error as HarnessFatalError).message).not.toContain(secretToken);
      expect((error as HarnessFatalError).message).toContain('***REDACTED***');
    }
  });

  it('redacts URL-encoded CLICKUP_TOKEN from HarnessFatalError', async () => {
    const outputDir = await prepareOutputDir();
    const secretToken = 'pk_leaked_secret_token_value';
    const encodedToken = encodeURIComponent(secretToken);
    vi.stubEnv('CLICKUP_TOKEN', secretToken);

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw new Error(`ClickUp request failed: ?Authorization=${encodedToken}`);
      }),
    });

    try {
      await useCase.execute(outputDir, { env: process.env });
      expect.fail('expected HarnessFatalError');
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessFatalError);
      expect((error as HarnessFatalError).message).not.toContain(secretToken);
      expect((error as HarnessFatalError).message).not.toContain(encodedToken);
      expect((error as HarnessFatalError).message).toContain('***REDACTED***');
    }
  });

  it('throws CorrelationBlockedError when correlator throws unexpectedly', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({
        demand: JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8')),
      })),
    });

    vi.spyOn(DemandDiffMemoryCorrelatorService.prototype, 'correlate').mockImplementation(() => {
      throw new Error('logic bug');
    });

    try {
      await useCase.execute(outputDir, { projectPath: process.cwd(), env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Correlation failed');
        expect(blocked.result.blockReason).toContain('logic bug');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('preserves BM25 warnings when correlator throws unexpectedly', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({
        demand: JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8')),
      })),
    });

    vi.spyOn(MemorySearchService.prototype, 'search').mockResolvedValue({
      chunks: [],
      warnings: ['BM25 memory context warning'],
    });
    vi.spyOn(DemandDiffMemoryCorrelatorService.prototype, 'correlate').mockImplementation(() => {
      throw new Error('logic bug');
    });

    try {
      await useCase.execute(outputDir, { projectPath: process.cwd(), env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Correlation failed');
        expect(blocked.result.blockReason).toContain('logic bug');
        expect(blocked.result.warnings).toContain('BM25 memory context warning');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });

  it('redacts CLICKUP_TOKEN from correlator BLOCKED blockReason and warnings', async () => {
    const outputDir = await prepareOutputDir();
    const secretToken = 'pk_leaked_secret_token_value';
    vi.stubEnv('CLICKUP_TOKEN', secretToken);

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({
        demand: JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8')),
      })),
    });

    vi.spyOn(DemandDiffMemoryCorrelatorService.prototype, 'correlate').mockReturnValue(
      createBlockedCorrelationResult(`Correlator blocked with token ${secretToken}`, [
        `Warning leaked ${secretToken}`,
      ]),
    );

    try {
      await useCase.execute(outputDir, { projectPath: process.cwd(), env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.status).toBe('BLOCKED');
        expect(blocked.result.blockReason).not.toContain(secretToken);
        expect(blocked.result.blockReason).toContain('***REDACTED***');
        expect(blocked.result.warnings[0]).not.toContain(secretToken);
        expect(blocked.result.warnings[0]).toContain('***REDACTED***');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
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

  it('throws CorrelationBlockedError when BM25 memory search fails', async () => {
    const outputDir = await prepareOutputDir();
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test_token');

    const useCase = buildUseCase({
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({
        demand: JSON.parse(await readFile(join(FIXTURES_DIR, 'demand-context.json'), 'utf8')),
      })),
    });

    vi.spyOn(MemorySearchService.prototype, 'search').mockRejectedValue(new Error('permission denied'));

    try {
      await useCase.execute(outputDir, { projectPath: process.cwd(), env: process.env });
      expect.fail('expected CorrelationBlockedError');
    } catch (error) {
      expectBlockedError(error, (blocked) => {
        expect(blocked.result.blockReason).toContain('Failed to search BM25 memory');
      });
    }

    await expectNoCorrelationArtifacts(outputDir);
  });
});

function expectBlockedError(
  error: unknown,
  assertions: (blocked: CorrelationBlockedError) => void,
): void {
  expect(error).toBeInstanceOf(CorrelationBlockedError);
  assertions(error as CorrelationBlockedError);
}

async function expectNoCorrelationArtifacts(outputDir: string): Promise<void> {
  await expect(access(join(outputDir, 'required-scenarios.json'))).rejects.toThrow();
  await expect(access(join(outputDir, 'correlation-report.md'))).rejects.toThrow();
}

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
    new ScenarioSelectorService(memorySearch),
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
