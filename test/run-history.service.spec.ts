import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { RunHistoryService } from '../src/application/services/run-history.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';

let tempDirs: string[] = [];

describe('RunHistoryService', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('creates run-history.jsonl and appends sanitized JSON lines', async () => {
    const projectPath = await tempProjectDir();
    const service = new RunHistoryService(new SanitizerService());

    await service.append(projectPath, {
      runId: 'run-1',
      ts: '2026-05-25T12:00:00.000Z',
      status: 'passed',
      demandId: 'DEM-001',
      summary: 'Bearer secret-token-123',
    });

    const lines = await service.readLines(projectPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.runId).toBe('run-1');
    expect(JSON.stringify(lines[0])).not.toContain('secret-token-123');
  });

  it('preserves existing history on append', async () => {
    const projectPath = await tempProjectDir();
    const service = new RunHistoryService(new SanitizerService());

    await service.append(projectPath, { runId: 'run-1', ts: '2026-05-25T12:00:00.000Z', status: 'passed' });
    await service.append(projectPath, { runId: 'run-2', ts: '2026-05-25T13:00:00.000Z', status: 'failed' });

    const lines = await service.readLines(projectPath);
    expect(lines.map((line) => line.runId)).toEqual(['run-1', 'run-2']);
  });
});

async function tempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-run-history-'));
  tempDirs.push(dir);
  return dir;
}
