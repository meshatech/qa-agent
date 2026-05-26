import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveBaseBranchFromEnv,
  resolveGitHubActionsPrRefs,
  resolveHeadBranchFromEnv,
  resolvePullNumberFromEnv,
} from '../src/infra/github/github-actions-pr-refs.resolver.js';

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

async function writeEventFile(number: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-refs-'));
  tempDirs.push(dir);
  const eventPath = join(dir, 'event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: { number } }), 'utf8');
  return eventPath;
}

describe('resolvePullNumberFromEnv', () => {
  it('resolves pull number from GITHUB_REF', async () => {
    await expect(
      resolvePullNumberFromEnv({ GITHUB_REF: 'refs/pull/42/merge' }),
    ).resolves.toBe(42);
  });

  it('resolves pull number from GITHUB_PR_NUMBER', async () => {
    await expect(resolvePullNumberFromEnv({ GITHUB_PR_NUMBER: '15' })).resolves.toBe(15);
  });

  it('resolves pull number from GITHUB_EVENT_PATH when ref is not a pull ref', async () => {
    const eventPath = await writeEventFile(88);
    await expect(
      resolvePullNumberFromEnv({
        GITHUB_REF: 'refs/heads/main',
        GITHUB_EVENT_PATH: eventPath,
      }),
    ).resolves.toBe(88);
  });
});

describe('resolveBaseBranchFromEnv / resolveHeadBranchFromEnv', () => {
  it('reads base and head branches from env', () => {
    const env = {
      GITHUB_BASE_REF: 'main',
      GITHUB_HEAD_REF: 'feature/test',
    };

    expect(resolveBaseBranchFromEnv(env)).toBe('main');
    expect(resolveHeadBranchFromEnv(env)).toBe('feature/test');
  });

  it('returns undefined when branches are missing', () => {
    expect(resolveBaseBranchFromEnv({})).toBeUndefined();
    expect(resolveHeadBranchFromEnv({})).toBeUndefined();
  });
});

describe('resolveGitHubActionsPrRefs', () => {
  it('combines prNumber, baseBranch and headBranch', async () => {
    await expect(
      resolveGitHubActionsPrRefs({
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_BASE_REF: 'main',
        GITHUB_HEAD_REF: 'feature/test',
      }),
    ).resolves.toEqual({
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feature/test',
    });
  });

  it('returns undefined when GITHUB_BASE_REF is missing', async () => {
    await expect(
      resolveGitHubActionsPrRefs({
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_HEAD_REF: 'feature/test',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when GITHUB_HEAD_REF is missing', async () => {
    await expect(
      resolveGitHubActionsPrRefs({
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_BASE_REF: 'main',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when pull number is missing', async () => {
    await expect(
      resolveGitHubActionsPrRefs({
        GITHUB_BASE_REF: 'main',
        GITHUB_HEAD_REF: 'feature/test',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when pull number is not positive', async () => {
    await expect(
      resolveGitHubActionsPrRefs({
        GITHUB_REF: 'refs/pull/-1/merge',
        GITHUB_BASE_REF: 'main',
        GITHUB_HEAD_REF: 'feature/test',
      }),
    ).resolves.toBeUndefined();
  });
});
