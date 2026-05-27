import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PrContextReaderError } from '../src/domain/errors.js';
import {
  mapGitHubActionsToPullRequestContext,
  sanitizePrContextErrorMessage,
} from '../src/infra/github/github-actions-pr-context.mapper.js';

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

async function writePullRequestEvent(
  payload: Record<string, unknown> = {},
): Promise<{ dir: string; eventPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-context-'));
  tempDirs.push(dir);
  const eventPath = join(dir, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 42,
        title: 'PRJ-11552 — Fix login flow',
        user: { login: 'octocat' },
        ...payload,
      },
    }),
    'utf8',
  );
  return { dir, eventPath };
}

function buildPrEnv(eventPath: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_REF: 'refs/pull/42/merge',
    GITHUB_HEAD_REF: 'feature/test',
    GITHUB_BASE_REF: 'main',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: '/tmp/workspace',
    ...overrides,
  };
}

describe('mapGitHubActionsToPullRequestContext', () => {
  it('maps GitHub Actions env and event payload to PullRequestContext', async () => {
    const { eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath);

    await expect(mapGitHubActionsToPullRequestContext({ env })).resolves.toEqual({
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'PRJ-11552 — Fix login flow',
      author: 'octocat',
      clickUpTaskId: 'PRJ-11552',
    });
  });

  it('extracts clickUpTaskId from PR body when title has no task ID', async () => {
    const { eventPath } = await writePullRequestEvent({
      title: 'Fix login flow',
      body: 'Related to PRJ-11392',
    });
    const env = buildPrEnv(eventPath);

    await expect(mapGitHubActionsToPullRequestContext({ env })).resolves.toMatchObject({
      clickUpTaskId: 'PRJ-11392',
    });
  });

  it('omits clickUpTaskId when PR has no task ID', async () => {
    const { eventPath } = await writePullRequestEvent({ title: 'Fix login flow', body: 'No id' });
    const env = buildPrEnv(eventPath);

    const result = await mapGitHubActionsToPullRequestContext({ env });
    expect(result.clickUpTaskId).toBeUndefined();
    expect(result).toMatchObject({
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'Fix login flow',
      author: 'octocat',
    });
  });

  it('fails when GITHUB_HEAD_REF is missing', async () => {
    const { eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, { GITHUB_HEAD_REF: '' });

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'MISSING_CONTEXT',
    });
  });

  it('fails when GITHUB_BASE_REF is missing', async () => {
    const { eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, { GITHUB_BASE_REF: '' });

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'MISSING_CONTEXT',
    });
  });

  it('fails when event JSON is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-context-'));
    tempDirs.push(dir);
    const eventPath = join(dir, 'event.json');
    await writeFile(eventPath, '{ invalid json', 'utf8');
    const env = buildPrEnv(eventPath);

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'INVALID_EVENT',
    });
  });

  it('fails when pull_request.title is missing', async () => {
    const { eventPath } = await writePullRequestEvent({ title: '' });
    const env = buildPrEnv(eventPath);

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'INVALID_EVENT',
    });
  });

  it('fails when pull_request.user.login is missing', async () => {
    const { eventPath } = await writePullRequestEvent({ user: { login: '' } });
    const env = buildPrEnv(eventPath);

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'INVALID_EVENT',
    });
  });

  it('wraps schema validation failures as VALIDATION_FAILED', async () => {
    const { eventPath } = await writePullRequestEvent({ number: -1 });
    const env = buildPrEnv(eventPath, { GITHUB_REF: 'refs/pull/-1/merge' });

    await expect(mapGitHubActionsToPullRequestContext({ env })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PrContextReaderError &&
        (error.code === 'VALIDATION_FAILED' || error.code === 'MISSING_CONTEXT'),
    );
  });
});

describe('sanitizePrContextErrorMessage', () => {
  it('redacts multi-segment absolute paths and GitHub tokens from error messages', () => {
    const env = { GITHUB_TOKEN: 'ghp_super_secret_token' };
    const message = 'Failed reading /home/user/secret/event.json with ghp_super_secret_token';

    expect(sanitizePrContextErrorMessage(message, env)).toBe(
      'Failed reading <redacted> with ***REDACTED***',
    );
  });

  it('does not redact single-segment paths like /api', () => {
    const env = { GITHUB_TOKEN: 'ghp_super_secret_token' };
    const message = 'Request to /api failed with ghp_super_secret_token';

    expect(sanitizePrContextErrorMessage(message, env)).toBe(
      'Request to /api failed with ***REDACTED***',
    );
  });
});
