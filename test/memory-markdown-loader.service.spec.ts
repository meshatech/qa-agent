import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_HEADER_V1, MemoryMarkdownLoader } from '../src/application/services/memory-markdown-loader.service.js';

let tempDirs: string[] = [];

async function tempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-memory-loader-'));
  tempDirs.push(dir);
  return dir;
}

describe('MemoryMarkdownLoader', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('detects schemaVersion v1 when header is present and emits no warning', async () => {
    const projectPath = await tempProjectDir();
    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(projectPath, '.agent-qa', 'memory.md'), `${MEMORY_HEADER_V1}\n\n## Section\n`, 'utf8');

    const loader = new MemoryMarkdownLoader();
    const loaded = await loader.loadProject(projectPath);

    expect(loaded.schemaVersion).toBe('v1');
    expect(loaded.warnings).toEqual([]);
  });

  it('detects schemaVersion legacy and warns when header is missing', async () => {
    const projectPath = await tempProjectDir();
    await mkdir(join(projectPath, '.agent-qa'), { recursive: true });
    await writeFile(join(projectPath, '.agent-qa', 'memory.md'), '## Section\n<!-- type: route | id: ROUTE-001 -->\n', 'utf8');

    const loader = new MemoryMarkdownLoader();
    const loaded = await loader.loadProject(projectPath);

    expect(loaded.schemaVersion).toBe('legacy');
    expect(loaded.warnings[0]).toContain(MEMORY_HEADER_V1);
  });

  it('treats an empty or missing file as v1 without warnings', async () => {
    const projectPath = await tempProjectDir();

    const loader = new MemoryMarkdownLoader();
    const loaded = await loader.loadProject(projectPath);

    expect(loaded.text).toBe('');
    expect(loaded.schemaVersion).toBe('v1');
    expect(loaded.warnings).toEqual([]);
  });
});
