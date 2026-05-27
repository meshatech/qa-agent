import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { DemandDiffMemoryCorrelatorService } from '../src/application/services/demand-diff-memory-correlator.service.js';
import { prepareCorrelationReportArtifact } from '../src/domain/helpers/correlation-report-artifact.js';
import { CorrelationResultSchema } from '../src/domain/schemas/correlation.schema.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';
import * as atomicFileWrite from '../src/infra/persistence/atomic-file-write.js';
import { FileCorrelationArtifactsWriterAdapter } from '../src/infra/persistence/file-correlation-artifacts-writer.adapter.js';

const BASE_DEMAND: DemandContext = {
  taskId: 'PRJ-11404',
  title: 'Login improvements',
  description: 'Improve login',
  acceptanceCriteria: ['Login route validates user credentials'],
  attachments: [],
  status: 'fazendo',
  assignees: [],
  priority: null,
  dueDate: null,
};

const BASE_PR_DIFF: PrDiffContext = {
  schemaVersion: 'pr-diff-context.v1',
  pullRequest: {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature/login',
    title: 'PRJ-11404 login',
    author: 'dev',
    clickUpTaskId: 'PRJ-11404',
  },
  changedFiles: [
    {
      path: 'src/routes/login.ts',
      status: 'modified',
      kind: 'route',
      positiveLines: [{ type: 'added', lineNumber: 1, content: 'validate credentials' }],
      negativeLines: [],
      contextLines: [],
    },
  ],
  affectedRoutes: ['/login'],
  affectedSchemas: [],
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.restoreAllMocks();
});

describe('FileCorrelationArtifactsWriterAdapter', () => {
  it('writes required-scenarios.json and correlation-report.md from result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-correlation-artifacts-writer-'));
    tempDirs.push(dir);
    const adapter = new FileCorrelationArtifactsWriterAdapter();
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    const paths = await adapter.write(dir, result, {
      demandTitle: BASE_DEMAND.title,
      prNumber: BASE_PR_DIFF.pullRequest.prNumber,
    });

    const raw = await readFile(paths.requiredScenariosPath, 'utf8');
    const parsed = CorrelationResultSchema.parse(JSON.parse(raw));
    const reportMarkdown = prepareCorrelationReportArtifact(result, {
      demandTitle: BASE_DEMAND.title,
      prNumber: BASE_PR_DIFF.pullRequest.prNumber,
    });

    expect(paths.requiredScenariosPath.endsWith('required-scenarios.json')).toBe(true);
    expect(paths.correlationReportPath.endsWith('correlation-report.md')).toBe(true);
    expect(parsed.scenarios.length).toBeGreaterThan(0);
    expect(await readFile(paths.correlationReportPath, 'utf8')).toBe(reportMarkdown);
  });

  it('writes atomically without leaving a .tmp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-correlation-artifacts-writer-'));
    tempDirs.push(dir);
    const adapter = new FileCorrelationArtifactsWriterAdapter();
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });

    const paths = await adapter.write(dir, result);

    await expect(access(`${paths.requiredScenariosPath}.tmp`)).rejects.toThrow();
    await expect(access(`${paths.correlationReportPath}.tmp`)).rejects.toThrow();
    expect(CorrelationResultSchema.parse(JSON.parse(await readFile(paths.requiredScenariosPath, 'utf8')))).toEqual(
      result,
    );
  });

  it('removes .tmp file when rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-correlation-artifacts-writer-'));
    tempDirs.push(dir);
    const adapter = new FileCorrelationArtifactsWriterAdapter();
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });
    const finalPath = resolve(join(dir, 'required-scenarios.json'));
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(finalPath);

    await expect(adapter.write(dir, result)).rejects.toThrow();
    await expect(access(tmpPath)).rejects.toThrow();
  });

  it('does not leave final artifacts when the second staged write fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-correlation-artifacts-writer-'));
    tempDirs.push(dir);
    const adapter = new FileCorrelationArtifactsWriterAdapter();
    const result = new DemandDiffMemoryCorrelatorService().correlate({
      demand: BASE_DEMAND,
      prDiff: BASE_PR_DIFF,
      memoryResults: [],
    });
    const originalWrite = atomicFileWrite.writeAtomicFile;
    let callCount = 0;

    vi.spyOn(atomicFileWrite, 'writeAtomicFile').mockImplementation(async (...args) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('report write failed');
      }
      return originalWrite(...args);
    });

    await expect(adapter.write(dir, result)).rejects.toThrow('report write failed');
    await expect(access(join(dir, 'required-scenarios.json'))).rejects.toThrow();
    await expect(access(join(dir, 'correlation-report.md'))).rejects.toThrow();
    expect((await readdir(dir)).every((entry) => !entry.startsWith('.correlation-artifacts-'))).toBe(
      true,
    );
  });
});
