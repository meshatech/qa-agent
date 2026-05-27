import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const eventReadPaths = vi.hoisted(() => [] as string[]);

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      eventReadPaths.push(String(path));
      return actual.readFile(path, ...(rest as [Parameters<typeof actual.readFile>[1]?]));
    },
  };
});

import { mapGitHubActionsToPullRequestContext } from '../src/infra/github/github-actions-pr-context.mapper.js';

let tempDirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  eventReadPaths.length = 0;
});

afterEach(async () => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('mapGitHubActionsToPullRequestContext I/O', () => {
  it('reads GITHUB_EVENT_PATH only once per execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-context-io-'));
    tempDirs.push(dir);
    const eventPath = join(dir, 'event.json');
    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 42,
          title: 'PRJ-11552 — Fix login flow',
          user: { login: 'octocat' },
        },
      }),
      'utf8',
    );

    const env = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_HEAD_REF: 'feature/test',
      GITHUB_BASE_REF: 'main',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_WORKSPACE: '/tmp/workspace',
    };

    await mapGitHubActionsToPullRequestContext({ env });

    expect(eventReadPaths.filter((path) => path === eventPath)).toHaveLength(1);
  });
});
