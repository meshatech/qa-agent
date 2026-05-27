import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

export async function cleanupGitFixtures(): Promise<void> {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
}

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
}

export async function initRepoWithOriginMain(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
  tempDirs.push(dir);

  await initGitRepo(dir);
  await writeFile(join(dir, 'README.md'), 'base\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'base'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
  await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });

  await writeFile(join(dir, 'README.md'), 'changed\n', 'utf8');
  await execFileAsync('git', ['commit', '-am', 'change'], { cwd: dir });

  return dir;
}

export async function initRepoWithEmptyDiff(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-git-diff-'));
  tempDirs.push(dir);

  await initGitRepo(dir);
  await writeFile(join(dir, 'README.md'), 'same\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'same'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
  await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });

  return dir;
}
