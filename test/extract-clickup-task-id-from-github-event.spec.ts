import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { extractClickUpTaskIdFromGitHubEvent } from '../src/infra/github/github-actions-pr-context.mapper.js';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function writeEvent(payload: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-github-event-'));
  tempDirs.push(dir);
  const eventPath = join(dir, 'event.json');
  await writeFile(eventPath, JSON.stringify(payload), 'utf8');
  return eventPath;
}

describe('extractClickUpTaskIdFromGitHubEvent', () => {
  it('returns undefined when GITHUB_EVENT_PATH is missing', async () => {
    await expect(extractClickUpTaskIdFromGitHubEvent({})).resolves.toBeUndefined();
  });

  it('throws PrContextReaderError when the event file does not exist', async () => {
    await expect(
      extractClickUpTaskIdFromGitHubEvent({
        GITHUB_EVENT_PATH: join(tmpdir(), 'missing-event.json'),
      }),
    ).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'INVALID_EVENT',
    });
  });

  it('returns undefined when pull_request.title is missing', async () => {
    const eventPath = await writeEvent({
      pull_request: {
        user: { login: 'octocat' },
        body: 'PRJ-11392',
      },
    });

    await expect(
      extractClickUpTaskIdFromGitHubEvent({ GITHUB_EVENT_PATH: eventPath }),
    ).resolves.toBeUndefined();
  });

  it('throws PrContextReaderError when event payload is malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-github-event-'));
    tempDirs.push(dir);
    const eventPath = join(dir, 'event.json');
    await writeFile(eventPath, '{not-json', 'utf8');

    await expect(
      extractClickUpTaskIdFromGitHubEvent({ GITHUB_EVENT_PATH: eventPath }),
    ).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'INVALID_EVENT',
    });
  });

  it('extracts task ID from a valid GitHub pull_request event', async () => {
    const eventPath = await writeEvent({
      pull_request: {
        title: 'PRJ-11552 — Pipeline test',
        body: 'Details',
        user: { login: 'octocat' },
      },
    });

    await expect(
      extractClickUpTaskIdFromGitHubEvent({ GITHUB_EVENT_PATH: eventPath }),
    ).resolves.toBe('PRJ-11552');
  });

  it('extracts task ID from body after stripping control characters', async () => {
    const eventPath = await writeEvent({
      pull_request: {
        title: 'Fix login flow',
        body: 'Related to \x07PRJ-11392',
        user: { login: 'octocat' },
      },
    });

    await expect(
      extractClickUpTaskIdFromGitHubEvent({ GITHUB_EVENT_PATH: eventPath }),
    ).resolves.toBe('PRJ-11392');
  });

  it('does not extract task ID from body content beyond 10000 characters', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const padding = 'x'.repeat(10001);
    const eventPath = await writeEvent({
      pull_request: {
        title: 'Fix login flow',
        body: `${padding} PRJ-99999`,
        user: { login: 'octocat' },
      },
    });

    await expect(
      extractClickUpTaskIdFromGitHubEvent({ GITHUB_EVENT_PATH: eventPath }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'PR body truncated to 10000 characters; ClickUp task IDs beyond this limit may not be detected',
    );

    warnSpy.mockRestore();
  });
});
