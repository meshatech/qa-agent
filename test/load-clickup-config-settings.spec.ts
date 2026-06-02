import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { loadClickUpConfigSettings, resolveAgentQaConfigPath } from '../src/application/helpers/load-clickup-config-settings.js';

const mockLoader = {
  async load(path: string): Promise<unknown> {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path, 'utf8'));
  },
};

describe('loadClickUpConfigSettings', () => {
  it('returns taskId and customIdPattern from valid config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-agent-config-'));
    const configPath = join(dir, 'agent-qa.config.json');
    await writeFile(configPath, JSON.stringify({
      baseUrl: 'http://localhost',
      appDomains: ['localhost'],
      demand: { id: 'D1', title: 'T', description: 'D' },
      auth: { kind: 'none' },
      llm: { provider: 'fake' },
      clickup: { taskId: 'PRJ-12345', customIdPattern: 'PRJ-\\d+' },
    }), 'utf8');

    const result = await loadClickUpConfigSettings(mockLoader, { AGENT_QA_CONFIG: configPath, GITHUB_WORKSPACE: dir });

    expect(result.taskId).toBe('PRJ-12345');
    expect(result.customIdPattern).toBe('PRJ-\\d+');

    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty object when config has no clickup section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-agent-config-'));
    const configPath = join(dir, 'agent-qa.config.json');
    await writeFile(configPath, JSON.stringify({
      baseUrl: 'http://localhost',
      appDomains: ['localhost'],
      demand: { id: 'D1', title: 'T', description: 'D' },
      auth: { kind: 'none' },
      llm: { provider: 'fake' },
    }), 'utf8');

    const result = await loadClickUpConfigSettings(mockLoader, { AGENT_QA_CONFIG: configPath, GITHUB_WORKSPACE: dir });

    expect(result.taskId).toBeUndefined();
    expect(result.customIdPattern).toBeUndefined();

    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty object when configLoader throws', async () => {
    const failingLoader = {
      async load(): Promise<unknown> {
        throw new Error('File not found');
      },
    };

    const result = await loadClickUpConfigSettings(failingLoader, { AGENT_QA_CONFIG: '/nonexistent/config.json', GITHUB_WORKSPACE: '/tmp' });

    expect(result.taskId).toBeUndefined();
    expect(result.customIdPattern).toBeUndefined();
  });

  it('returns empty object when config fails schema validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-agent-config-'));
    const configPath = join(dir, 'agent-qa.config.json');
    await writeFile(configPath, JSON.stringify({ invalid: true }), 'utf8');

    const result = await loadClickUpConfigSettings(mockLoader, { AGENT_QA_CONFIG: configPath, GITHUB_WORKSPACE: dir });

    expect(result.taskId).toBeUndefined();
    expect(result.customIdPattern).toBeUndefined();

    await rm(dir, { recursive: true, force: true });
  });

  it('resolves config path from env variables', () => {
    const path = resolveAgentQaConfigPath({ AGENT_QA_CONFIG: './custom.json', GITHUB_WORKSPACE: '/workspace' });
    expect(path).toBe(resolve('/workspace', './custom.json'));
  });

  it('resolves default config path when env is empty', () => {
    const path = resolveAgentQaConfigPath({});
    expect(path).toBe(resolve(process.cwd(), './agent-qa.config.json'));
  });
});
