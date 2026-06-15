import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  buildPullRequestDiffArgs,
  ExecGitRepositoryAdapter,
  formatGitDiffFailedMessage,
} from '../src/infra/git/exec-git-repository.adapter.js';
import { PrContextReaderError } from '../src/domain/errors.js';
import {
  cleanupGitFixtures,
  initRepoWithEmptyDiff,
  initRepoWithOriginMain,
} from './helpers/git-fixtures.js';

const execFileAsync = promisify(execFile);

let tempDirs: string[] = [];

afterEach(async () => {
  await cleanupGitFixtures();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function initBareRepoWithMain(): Promise<string> {
  const bareDir = await mkdtemp(join(tmpdir(), 'agent-qa-git-bare-'));
  tempDirs.push(bareDir);
  await execFileAsync('git', ['init', '--bare'], { cwd: bareDir });

  const seedDir = await mkdtemp(join(tmpdir(), 'agent-qa-git-seed-'));
  tempDirs.push(seedDir);
  await execFileAsync('git', ['init'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: seedDir });
  await writeFile(join(seedDir, 'README.md'), 'base\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: seedDir });
  await execFileAsync('git', ['commit', '-m', 'base'], { cwd: seedDir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: seedDir });
  await execFileAsync('git', ['remote', 'add', 'origin', bareDir], { cwd: seedDir });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: seedDir });

  return bareDir;
}

async function cloneFromBare(bareDir: string, options?: { depth?: number }): Promise<string> {
  const cloneDir = await mkdtemp(join(tmpdir(), 'agent-qa-git-clone-'));
  tempDirs.push(cloneDir);

  const args = ['clone'];
  if (options?.depth !== undefined) {
    args.push('--depth', String(options.depth));
  }
  args.push(bareDir, cloneDir);

  await execFileAsync('git', args);
  return cloneDir;
}

async function deleteOriginMainRef(cwd: string): Promise<void> {
  await execFileAsync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd });
}

async function markRepositoryShallow(cwd: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  await writeFile(join(cwd, '.git/shallow'), `${stdout.trim()}\n`, 'utf8');
}

describe('ExecGitRepositoryAdapter', () => {
  let adapter: ExecGitRepositoryAdapter;

  beforeEach(() => {
    adapter = new ExecGitRepositoryAdapter();
  });

  describe('formatGitDiffFailedMessage', () => {
    it('returns explicit message when stdout exceeds maxBuffer', () => {
      const error = Object.assign(new Error('maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      });

      expect(formatGitDiffFailedMessage(error)).toBe(
        'Git diff output exceeded 50MB buffer limit',
      );
    });

    it('returns generic git diff failure message for other errors', () => {
      expect(formatGitDiffFailedMessage(new Error('fatal: bad revision'))).toBe(
        'Git diff failed: fatal: bad revision',
      );
    });
  });

  it('buildPullRequestDiffArgs uses origin/base...HEAD range', () => {
    expect(buildPullRequestDiffArgs('main')).toEqual(['diff', '--no-color', 'origin/main...HEAD']);
  });

  it('runs git diff origin/base...HEAD against local repository', async () => {
    const dir = await initRepoWithOriginMain();

    const rawDiff = await adapter.diffPullRequest('main', dir);

    expect(rawDiff).toContain('README.md');
    expect(rawDiff).toContain('-base');
    expect(rawDiff).toContain('+changed');
  });

  it('captures empty diff as empty string when origin base matches HEAD', async () => {
    const dir = await initRepoWithEmptyDiff();

    const rawDiff = await adapter.diffPullRequest('main', dir);

    expect(rawDiff).toBe('');
  });

  it('resolves ensureBaseBranchAvailable when origin base branch already exists', async () => {
    const dir = await initRepoWithOriginMain();

    await expect(adapter.ensureBaseBranchAvailable('main', dir)).resolves.toBeUndefined();
  });

  it.each(['--upload-pack', 'main;rm', ''])(
    'throws VALIDATION_FAILED for invalid base branch ref %s',
    async (baseBranch) => {
      await expect(adapter.ensureBaseBranchAvailable(baseBranch, '/tmp')).rejects.toMatchObject({
        name: 'PrContextReaderError',
        code: 'VALIDATION_FAILED',
        message: `Invalid base branch ref: ${baseBranch}`,
      });
    },
  );

  it('throws BASE_BRANCH_UNAVAILABLE when origin base branch is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
    tempDirs.push(dir);
    await execFileAsync('git', ['init'], { cwd: dir });

    await expect(adapter.ensureBaseBranchAvailable('main', dir)).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'BASE_BRANCH_UNAVAILABLE',
    });
    await expect(adapter.ensureBaseBranchAvailable('main', dir)).rejects.toBeInstanceOf(
      PrContextReaderError,
    );
  });

  it('fetches origin/main when remote tracking ref was removed', async () => {
    const bareDir = await initBareRepoWithMain();
    const cloneDir = await cloneFromBare(bareDir);
    await deleteOriginMainRef(cloneDir);

    expect(await adapter.hasRemoteBranch('main', cloneDir)).toBe(false);
    await expect(adapter.ensureBaseBranchAvailable('main', cloneDir)).resolves.toBeUndefined();
    expect(await adapter.hasRemoteBranch('main', cloneDir)).toBe(true);
  });

  it('throws BASE_BRANCH_UNAVAILABLE on shallow checkout without attempting fetch', async () => {
    const cloneDir = await initRepoWithOriginMain();
    await deleteOriginMainRef(cloneDir);
    await markRepositoryShallow(cloneDir);

    expect(await adapter.isShallowRepository(cloneDir)).toBe(true);
    await expect(adapter.ensureBaseBranchAvailable('main', cloneDir)).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'BASE_BRANCH_UNAVAILABLE',
      message: 'Base branch is unavailable in a shallow checkout',
    });
    expect(await adapter.hasRemoteBranch('main', cloneDir)).toBe(false);
  });

  it('throws PrContextReaderError when origin base branch is missing for diff', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
    tempDirs.push(dir);
    await execFileAsync('git', ['init'], { cwd: dir });

    let caught: unknown;
    try {
      await adapter.diffPullRequest('main', dir);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PrContextReaderError);
    expect(caught).toMatchObject({
      name: 'PrContextReaderError',
      code: 'GIT_DIFF_FAILED',
    });
    const readerError = caught as PrContextReaderError;
    expect(readerError.message.toLowerCase()).toMatch(/origin\/main|unknown revision|ambiguous argument/);
    expect(readerError.cause).toBeTruthy();
  });
});
