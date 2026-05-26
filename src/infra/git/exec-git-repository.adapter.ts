import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitRepositoryPort } from '../../application/ports/git-repository.port.js';

const execFileAsync = promisify(execFile);

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
}
