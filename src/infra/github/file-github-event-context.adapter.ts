import { Injectable } from '@nestjs/common';

import type { GitHubEventContextPort } from '../../application/ports/github-event-context.port.js';
import { resolvePullNumberFromEnv } from './github-actions-pr-refs.resolver.js';

@Injectable()
export class FileGitHubEventContextAdapter implements GitHubEventContextPort {
  async resolvePullNumber(): Promise<number | undefined> {
    return resolvePullNumberFromEnv(process.env);
  }
}
