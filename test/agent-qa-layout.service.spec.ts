import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentQaLayoutService } from '../src/application/services/agent-qa-layout.service.js';

let tempDirs: string[] = [];

describe('AgentQaLayoutService', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('creates .agent-qa when missing', async () => {
    const projectPath = await tempProjectDir();
    const service = new AgentQaLayoutService();

    const result = await service.ensureDirectory(projectPath);

    expect(result.created).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.dir).toBe(join(projectPath, '.agent-qa'));
  });

  it('preserves existing .agent-qa directory', async () => {
    const projectPath = await tempProjectDir();
    const service = new AgentQaLayoutService();

    const first = await service.ensureDirectory(projectPath);
    const second = await service.ensureDirectory(projectPath);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.warnings).toEqual([]);
  });
});

async function tempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-layout-'));
  tempDirs.push(dir);
  return dir;
}
