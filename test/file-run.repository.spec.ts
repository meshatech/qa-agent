import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunRepository } from '../src/infra/persistence/file-run.repository.js';
import { ReportRenderer } from '../src/infra/persistence/report-renderer.js';
import { RunDirectoryManager } from '../src/infra/persistence/run-directory.manager.js';

function makeRepo(): FileRunRepository {
  return new FileRunRepository(
    { create: vi.fn() } as unknown as RunDirectoryManager,
    { renderExecutionReport: vi.fn() } as unknown as ReportRenderer,
  );
}

describe('FileRunRepository — exists and listFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'qa-agent-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exists returns true for existing file', async () => {
    const repo = makeRepo();
    writeFileSync(join(tempDir, 'test.txt'), 'hello');
    const result = await repo.exists(tempDir, 'test.txt');
    expect(result).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    const repo = makeRepo();
    const result = await repo.exists(tempDir, 'missing.txt');
    expect(result).toBe(false);
  });

  it('listFiles returns files in directory', async () => {
    const repo = makeRepo();
    mkdirSync(join(tempDir, 'bugs', 'B001'), { recursive: true });
    writeFileSync(join(tempDir, 'bugs', 'B001', 'screenshot.png'), '');
    writeFileSync(join(tempDir, 'bugs', 'B001', 'console.log'), '');

    const files = await repo.listFiles(tempDir, 'bugs/B001');
    expect(files).toContain('screenshot.png');
    expect(files).toContain('console.log');
    expect(files).toHaveLength(2);
  });

  it('listFiles returns empty array for missing directory', async () => {
    const repo = makeRepo();
    const files = await repo.listFiles(tempDir, 'missing');
    expect(files).toEqual([]);
  });

  it('listFiles returns empty array for non-directory path', async () => {
    const repo = makeRepo();
    writeFileSync(join(tempDir, 'file.txt'), 'hello');
    const files = await repo.listFiles(tempDir, 'file.txt');
    expect(files).toEqual([]);
  });

  it('blocks path traversal in exists', async () => {
    const repo = makeRepo();
    const result = await repo.exists(tempDir, '../secret.txt');
    expect(result).toBe(false);
  });

  it('blocks path traversal in listFiles', async () => {
    const repo = makeRepo();
    const files = await repo.listFiles(tempDir, '../secret');
    expect(files).toEqual([]);
  });

  it('blocks access to sibling directory with same prefix', async () => {
    const repo = makeRepo();
    const siblingDir = tempDir + '-evil';
    mkdirSync(siblingDir);
    writeFileSync(join(siblingDir, 'secret.txt'), 'shh');

    const result = await repo.exists(tempDir, `../${siblingDir.split('/').pop()}/secret.txt`);
    expect(result).toBe(false);
  });
});
