import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { ExecGitRepositoryAdapter } from '../src/infra/git/exec-git-repository.adapter.js';
import { PrContextReaderError } from '../src/domain/errors.js';

const execFileAsync = promisify(execFile);

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function initRepoWithOriginMain(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
  tempDirs.push(dir);

  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });

  await writeFile(join(dir, 'README.md'), 'base\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'base'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
  await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });

  await writeFile(join(dir, 'README.md'), 'changed\n', 'utf8');
  await execFileAsync('git', ['commit', '-am', 'change'], { cwd: dir });

  return dir;
}

describe('ExecGitRepositoryAdapter', () => {
  let adapter: ExecGitRepositoryAdapter;

  beforeEach(() => {
    adapter = new ExecGitRepositoryAdapter();
  });

  it('runs git diff origin/base...HEAD against local repository', async () => {
    const dir = await initRepoWithOriginMain();

    const rawDiff = await adapter.diffPullRequest('main', dir);

    expect(rawDiff).toContain('README.md');
    expect(rawDiff).toContain('-base');
    expect(rawDiff).toContain('+changed');
  });

  it('throws PrContextReaderError when origin base branch is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
    tempDirs.push(dir);
    await execFileAsync('git', ['init'], { cwd: dir });

    await expect(adapter.diffPullRequest('main', dir)).rejects.toMatchObject({
      name: 'PrContextReaderError',
      code: 'GIT_DIFF_FAILED',
    });
    await expect(adapter.diffPullRequest('main', dir)).rejects.toBeInstanceOf(PrContextReaderError);
  });
});
