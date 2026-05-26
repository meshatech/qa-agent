import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FileGitHubEventContextAdapter } from '../src/infra/github/file-github-event-context.adapter.js';

let tempDirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(async () => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('FileGitHubEventContextAdapter', () => {
  it('resolves pull number from GITHUB_REF', async () => {
    process.env.GITHUB_REF = 'refs/pull/42/merge';
    const adapter = new FileGitHubEventContextAdapter();

    await expect(adapter.resolvePullNumber()).resolves.toBe(42);
  });

  it('resolves pull number from GITHUB_EVENT_PATH when ref is base branch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-github-event-'));
    tempDirs.push(dir);
    const eventPath = join(dir, 'event.json');
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 88 } }), 'utf8');

    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_EVENT_PATH = eventPath;
    const adapter = new FileGitHubEventContextAdapter();

    await expect(adapter.resolvePullNumber()).resolves.toBe(88);
  });

  it('resolves pull number from GITHUB_PR_NUMBER', async () => {
    process.env.GITHUB_PR_NUMBER = '15';
    const adapter = new FileGitHubEventContextAdapter();

    await expect(adapter.resolvePullNumber()).resolves.toBe(15);
  });
});
