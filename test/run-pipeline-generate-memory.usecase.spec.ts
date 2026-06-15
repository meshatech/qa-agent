import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MEMORY_HEADER_V1 } from '../src/application/services/memory-markdown-loader.service.js';
import { RunPipelineGenerateMemoryUseCase } from '../src/application/use-cases/run-pipeline-generate-memory.usecase.js';
import type { DiffMemoryExtractorService } from '../src/application/services/diff-memory-extractor.service.js';

let tempDirs: string[] = [];

async function tempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-generate-memory-'));
  tempDirs.push(dir);
  return dir;
}

describe('RunPipelineGenerateMemoryUseCase', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('writes memory.md with the v1 contract header', async () => {
    const projectPath = await tempProjectDir();
    const extractor = {
      extract: vi.fn().mockResolvedValue([
        { id: 'ROUTE-001', type: 'route', title: 'Login route', content: 'Route /login' },
      ]),
    } as unknown as DiffMemoryExtractorService;

    const useCase = new RunPipelineGenerateMemoryUseCase(extractor);
    const result = await useCase.execute(projectPath, { changedFiles: ['src/routes/login.ts'] });

    const content = await readFile(result.memoryPath, 'utf8');
    expect(content.split(/\r?\n/)[0]).toBe(MEMORY_HEADER_V1);
    expect(content).toContain('## Login route');
  });
});
