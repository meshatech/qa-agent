import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { FileRunRepository } from '../src/infra/persistence/file-run.repository.js';
import { ReportRenderer } from '../src/infra/persistence/report-renderer.js';
import { RunDirectoryManager } from '../src/infra/persistence/run-directory.manager.js';
import { MemoryChunkRenderer } from '../src/application/services/memory-chunk-renderer.service.js';
import { MEMORY_HEADER_V1 } from '../src/application/services/memory-markdown-loader.service.js';
import { RunPipelinePromoteLearningUseCase } from '../src/application/use-cases/run-pipeline-promote-learning.usecase.js';
import type { LearningCandidatesArtifact } from '../src/domain/schemas/learning-candidate.schema.js';
import type { MemoryStorePort } from '../src/application/ports/memory-store.port.js';
import type { ConfigLoaderPort } from '../src/application/ports/config-loader.port.js';
import type { RunHistoryService } from '../src/application/services/run-history.service.js';

const MOCK_CONFIG = {
  baseUrl: 'http://127.0.0.1:4173/',
  appDomains: ['127.0.0.1'],
  demand: { id: 'PRJ-TEST', title: 'Test', description: 'Test desc' },
  auth: { kind: 'none' as const },
  llm: { provider: 'fake' as const },
};

function fakeConfigLoader(): ConfigLoaderPort {
  return { load: async () => MOCK_CONFIG } as unknown as ConfigLoaderPort;
}

let tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-promote-learning-'));
  tempDirs.push(dir);
  return dir;
}

function makeUseCase(): RunPipelinePromoteLearningUseCase {
  const repository = new FileRunRepository(
    { create: vi.fn() } as unknown as RunDirectoryManager,
    { renderExecutionReport: vi.fn() } as unknown as ReportRenderer,
  );
  const memoryStore = { upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }) } as unknown as MemoryStorePort;
  const runHistory = { readLines: vi.fn().mockResolvedValue([]) } as unknown as RunHistoryService;
  return new RunPipelinePromoteLearningUseCase(new MemoryChunkRenderer(), repository, memoryStore, runHistory, fakeConfigLoader());
}

function candidatesArtifact(): LearningCandidatesArtifact {
  return {
    schemaVersion: 'learning-candidates.v1',
    runId: 'run-1',
    generatedAt: new Date().toISOString(),
    count: 1,
    candidates: [
      {
        id: 'cand-1',
        type: 'semantic_locator',
        runId: 'run-1',
        description: 'Account menu trigger',
        content: 'button[data-testid="account-menu"]',
        source: 'confirmed',
        confidence: 0.9,
        risk: 'low',
        generatedAt: new Date().toISOString(),
      },
    ],
  };
}

describe('RunPipelinePromoteLearningUseCase', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('adds the v1 header when promoting into a memory.md without one', async () => {
    const projectPath = await tempDir();
    const outputDir = await tempDir();

    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(projectPath, '.agent-qa', 'memory.md'), '## Existing\n<!-- type: route | id: ROUTE-001 -->\nLegacy content\n', 'utf8');
    await writeFile(join(outputDir, 'learning-candidates.json'), JSON.stringify(candidatesArtifact()), 'utf8');

    const useCase = makeUseCase();
    const result = await useCase.execute(outputDir, { projectPath, autoApprove: true });

    expect(result.promotedCount).toBe(1);
    const content = await readFile(join(projectPath, '.agent-qa', 'memory.md'), 'utf8');
    expect(content.split(/\r?\n/)[0]).toBe(MEMORY_HEADER_V1);
    expect(content).toContain('Legacy content');
    expect(content).toContain('Account menu trigger');
  });

  it('marks the promoted record as promoted when the source run passed, candidate otherwise', async () => {
    const repository = new FileRunRepository(
      { create: vi.fn() } as unknown as RunDirectoryManager,
      { renderExecutionReport: vi.fn() } as unknown as ReportRenderer,
    );
    const memoryStore = { upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }) } as unknown as MemoryStorePort;
    const runHistory = {
      readLines: vi.fn().mockResolvedValue([{ runId: 'run-1', ts: new Date().toISOString(), status: 'passed' }]),
    } as unknown as RunHistoryService;
    const useCase = new RunPipelinePromoteLearningUseCase(new MemoryChunkRenderer(), repository, memoryStore, runHistory, fakeConfigLoader());

    const projectPath = await tempDir();
    const outputDir = await tempDir();
    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(outputDir, 'learning-candidates.json'), JSON.stringify(candidatesArtifact()), 'utf8');

    await useCase.execute(outputDir, { projectPath, autoApprove: true });

    expect(memoryStore.upsertPromoted).toHaveBeenCalledTimes(1);
    const [records] = (memoryStore.upsertPromoted as ReturnType<typeof vi.fn>).mock.calls[0] as [Array<{ promotionStatus: string; sourceRunId: string }>];
    expect(records[0]?.promotionStatus).toBe('promoted');
    expect(records[0]?.sourceRunId).toBe('run-1');
  });

  it('marks the promoted record as candidate when there is no passing run for it', async () => {
    const repository = new FileRunRepository(
      { create: vi.fn() } as unknown as RunDirectoryManager,
      { renderExecutionReport: vi.fn() } as unknown as ReportRenderer,
    );
    const memoryStore = { upsertPromoted: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }) } as unknown as MemoryStorePort;
    const runHistory = { readLines: vi.fn().mockResolvedValue([]) } as unknown as RunHistoryService;
    const useCase = new RunPipelinePromoteLearningUseCase(new MemoryChunkRenderer(), repository, memoryStore, runHistory, fakeConfigLoader());

    const projectPath = await tempDir();
    const outputDir = await tempDir();
    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(outputDir, 'learning-candidates.json'), JSON.stringify(candidatesArtifact()), 'utf8');

    await useCase.execute(outputDir, { projectPath, autoApprove: true });

    const [records] = (memoryStore.upsertPromoted as ReturnType<typeof vi.fn>).mock.calls[0] as [Array<{ promotionStatus: string }>];
    expect(records[0]?.promotionStatus).toBe('candidate');
  });

  it('does not duplicate the header when memory.md already has one', async () => {
    const projectPath = await tempDir();
    const outputDir = await tempDir();

    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(projectPath, '.agent-qa', 'memory.md'), `${MEMORY_HEADER_V1}\n\n## Existing\n<!-- type: route | id: ROUTE-001 -->\nContent\n`, 'utf8');
    await writeFile(join(outputDir, 'learning-candidates.json'), JSON.stringify(candidatesArtifact()), 'utf8');

    const useCase = makeUseCase();
    await useCase.execute(outputDir, { projectPath, autoApprove: true });

    const content = await readFile(join(projectPath, '.agent-qa', 'memory.md'), 'utf8');
    expect(content.match(new RegExp(MEMORY_HEADER_V1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
  });
});
