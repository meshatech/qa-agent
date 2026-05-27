import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PrContextReaderError } from '../src/domain/errors.js';
import type { GitRepositoryPort } from '../src/application/ports/git-repository.port.js';
import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { GitHubActionsPrContextReaderAdapter } from '../src/infra/github/github-actions-pr-context-reader.adapter.js';
import { cleanupGitFixtures, initRepoWithOriginMain } from './helpers/git-fixtures.js';

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
  await cleanupGitFixtures();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function writePullRequestEvent(): Promise<{ dir: string; eventPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-reader-'));
  tempDirs.push(dir);
  const eventPath = join(dir, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 42,
        title: 'Fix login flow',
        user: { login: 'octocat' },
      },
    }),
    'utf8',
  );
  return { dir, eventPath };
}

function buildPrEnv(eventPath: string, workspace: string): NodeJS.ProcessEnv {
  return {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_REF: 'refs/pull/42/merge',
    GITHUB_HEAD_REF: 'feature/test',
    GITHUB_BASE_REF: 'main',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: workspace,
  };
}

describe('GitHubActionsPrContextReaderAdapter', () => {
  it('ensures base branch availability before git diff', async () => {
    const { dir, eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, dir);
    const ensureBaseBranchAvailable = vi.fn().mockResolvedValue(undefined);
    const diffPullRequest = vi.fn().mockResolvedValue('diff --git a/file.ts b/file.ts\n');
    const git: GitRepositoryPort = {
      isShallowRepository: async () => false,
      hasRemoteBranch: async () => true,
      ensureBaseBranchAvailable,
      diffPullRequest,
    };
    const adapter = new GitHubActionsPrContextReaderAdapter(git);

    const result = await adapter.read({ cwd: dir, env });

    expect(ensureBaseBranchAvailable).toHaveBeenCalledWith('main', dir);
    expect(diffPullRequest).toHaveBeenCalledWith('main', dir);
    expect(ensureBaseBranchAvailable.mock.invocationCallOrder[0]).toBeLessThan(
      diffPullRequest.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      pullRequest: {
        prNumber: 42,
        baseBranch: 'main',
        headBranch: 'feature/test',
        title: 'Fix login flow',
        author: 'octocat',
      },
      rawDiff: 'diff --git a/file.ts b/file.ts\n',
      changedFiles: [
        {
          path: 'file.ts',
          status: 'modified',
          kind: 'other',
          positiveLines: [],
          negativeLines: [],
          contextLines: [],
        },
      ],
      affectedRoutes: [],
    });
  });

  it('detects affected routes from classified route files in the diff', async () => {
    const { dir, eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, dir);
    const rawDiff = [
      'diff --git a/src/routes/foo.ts b/src/routes/foo.ts',
      '--- a/src/routes/foo.ts',
      '+++ b/src/routes/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const git: GitRepositoryPort = {
      isShallowRepository: async () => false,
      hasRemoteBranch: async () => true,
      ensureBaseBranchAvailable: vi.fn().mockResolvedValue(undefined),
      diffPullRequest: vi.fn().mockResolvedValue(rawDiff),
    };
    const adapter = new GitHubActionsPrContextReaderAdapter(git);

    const result = await adapter.read({ cwd: dir, env });

    expect(result.affectedRoutes).toEqual(['/foo']);
    expect(result.changedFiles[0]?.kind).toBe('route');
  });

  it('propagates base branch ensure failures', async () => {
    const { dir, eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, dir);
    const ensureError = new PrContextReaderError(
      'Base branch is not accessible locally',
      undefined,
      'BASE_BRANCH_UNAVAILABLE',
    );
    const git: GitRepositoryPort = {
      isShallowRepository: async () => false,
      hasRemoteBranch: async () => false,
      ensureBaseBranchAvailable: vi.fn().mockRejectedValue(ensureError),
      diffPullRequest: vi.fn(),
    };
    const adapter = new GitHubActionsPrContextReaderAdapter(git);

    await expect(adapter.read({ cwd: dir, env })).rejects.toBe(ensureError);
    expect(git.diffPullRequest).not.toHaveBeenCalled();
  });

  it('propagates git diff failures', async () => {
    const { dir, eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, dir);
    const gitError = new PrContextReaderError('Git diff failed', undefined, 'GIT_DIFF_FAILED');
    const git: GitRepositoryPort = {
      isShallowRepository: async () => false,
      hasRemoteBranch: async () => true,
      ensureBaseBranchAvailable: vi.fn().mockResolvedValue(undefined),
      diffPullRequest: vi.fn().mockRejectedValue(gitError),
    };
    const adapter = new GitHubActionsPrContextReaderAdapter(git);

    await expect(adapter.read({ cwd: dir, env })).rejects.toBe(gitError);
  });

  it('captures raw git diff end-to-end with real git repository', async () => {
    const repoDir = await initRepoWithOriginMain();
    const { dir, eventPath } = await writePullRequestEvent();
    const env = buildPrEnv(eventPath, repoDir);
    const adapter = new GitHubActionsPrContextReaderAdapter(new ExecGitRepositoryAdapter());

    const result = await adapter.read({ cwd: repoDir, env });

    expect(result.pullRequest).toEqual({
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feature/test',
      title: 'Fix login flow',
      author: 'octocat',
    });
    expect(result.rawDiff).toContain('README.md');
    expect(result.rawDiff).toContain('-base');
    expect(result.rawDiff).toContain('+changed');
    expect(result.changedFiles).toEqual([
      {
        path: 'README.md',
        status: 'modified',
        kind: 'docs',
        positiveLines: [
          {
            type: 'added',
            lineNumber: 1,
            content: 'changed',
          },
        ],
        negativeLines: [
          {
            type: 'removed',
            lineNumber: 1,
            content: 'base',
          },
        ],
        contextLines: [],
      },
    ]);
    expect(result.affectedRoutes).toEqual([]);
  });
});
