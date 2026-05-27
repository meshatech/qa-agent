import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitRepositoryPort } from '../../application/ports/git-repository.port.js';
import { PrContextReaderError } from '../../domain/errors.js';

const execFileAsync = promisify(execFile);

const GITHUB_TOKEN_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'INPUT_GITHUB_TOKEN'] as const;

function sanitizeGitErrorMessage(message: string): string {
  let sanitized = message;
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const token = process.env[key]?.trim();
    if (token) {
      sanitized = sanitized.split(token).join('***REDACTED***');
    }
  }
  return sanitized;
}

function readExecFileErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const withStderr = error as { stderr?: string | Buffer; message?: string };
    const stderr = withStderr.stderr ? String(withStderr.stderr).trim() : '';
    if (stderr) {
      return stderr;
    }
    if (withStderr.message) {
      return withStderr.message;
    }
  }
  return String(error);
}

export function buildPullRequestDiffArgs(baseBranch: string): readonly [string, string] {
  return ['diff', `origin/${baseBranch}...HEAD`] as const;
}

@Injectable()
export class ExecGitRepositoryAdapter implements GitRepositoryPort {
  async isShallowRepository(cwd: string): Promise<boolean> {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd,
      encoding: 'utf8',
    });
    return stdout.trim() === 'true';
  }

  async hasRemoteBranch(baseRef: string, cwd: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', `origin/${baseRef}`], {
        cwd,
        encoding: 'utf8',
      });
      return true;
    } catch {
      return false;
    }
  }

  async ensureBaseBranchAvailable(baseBranch: string, cwd: string): Promise<void> {
    if (await this.hasRemoteBranch(baseBranch, cwd)) {
      return;
    }

    if (await this.isShallowRepository(cwd)) {
      throw new PrContextReaderError(
        'Base branch is unavailable in a shallow checkout',
        undefined,
        'BASE_BRANCH_UNAVAILABLE',
      );
    }

    try {
      await execFileAsync(
        'git',
        ['fetch', 'origin', `${baseBranch}:refs/remotes/origin/${baseBranch}`],
        { cwd, encoding: 'utf8' },
      );
    } catch (error) {
      const detail = readExecFileErrorMessage(error);
      throw new PrContextReaderError(
        sanitizeGitErrorMessage(`Base branch fetch failed: ${detail}`),
        error,
        'BASE_BRANCH_UNAVAILABLE',
      );
    }

    if (!(await this.hasRemoteBranch(baseBranch, cwd))) {
      throw new PrContextReaderError(
        'Base branch is not accessible locally',
        undefined,
        'BASE_BRANCH_UNAVAILABLE',
      );
    }
  }

  async diffPullRequest(baseBranch: string, cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...buildPullRequestDiffArgs(baseBranch)], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const detail = readExecFileErrorMessage(error);
      throw new PrContextReaderError(
        sanitizeGitErrorMessage(`Git diff failed: ${detail}`),
        error,
        'GIT_DIFF_FAILED',
      );
    }
  }
}
