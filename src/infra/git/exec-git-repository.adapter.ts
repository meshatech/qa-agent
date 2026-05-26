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
        sanitizeGitErrorMessage('Base branch is unavailable in a shallow checkout'),
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
      const message = error instanceof Error ? error.message : String(error);
      throw new PrContextReaderError(
        sanitizeGitErrorMessage('Base branch fetch failed'),
        sanitizeGitErrorMessage(message),
        'BASE_BRANCH_UNAVAILABLE',
      );
    }

    if (!(await this.hasRemoteBranch(baseBranch, cwd))) {
      throw new PrContextReaderError(
        'Base branch is not accessible locally',
        sanitizeGitErrorMessage('Base branch is not accessible locally'),
        'BASE_BRANCH_UNAVAILABLE',
      );
    }
  }

  async diffPullRequest(baseBranch: string, cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', `origin/${baseBranch}...HEAD`],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PrContextReaderError(
        sanitizeGitErrorMessage(`Git diff failed: ${message}`),
        sanitizeGitErrorMessage(message),
        'GIT_DIFF_FAILED',
      );
    }
  }
}
