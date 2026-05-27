import { Inject, Injectable } from '@nestjs/common';

import type {
  GitHubActionsPrContextReaderPort,
  PrContextReadResult,
} from '../../application/ports/github-actions-pr-context-reader.port.js';
import type { GitRepositoryPort } from '../../application/ports/git-repository.port.js';
import { detectAffectedRoutes } from './git-diff-affected-routes.detector.js';
import { detectAffectedSchemas } from './git-diff-affected-schemas.detector.js';
import { classifyChangedFiles } from './git-diff-changed-file-classifier.js';
import { parseGitDiffChangedFiles } from './git-diff-changed-files.parser.js';
import {
  mapGitHubActionsToPullRequestContext,
  resolveGitHubWorkspace,
} from './github-actions-pr-context.mapper.js';

@Injectable()
export class GitHubActionsPrContextReaderAdapter implements GitHubActionsPrContextReaderPort {
  constructor(@Inject('GitRepositoryPort') private readonly git: GitRepositoryPort) {}

  async read(options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }): Promise<PrContextReadResult> {
    const env = options?.env ?? process.env;
    const cwd = options?.cwd ?? resolveGitHubWorkspace(env);
    const pullRequest = await mapGitHubActionsToPullRequestContext({ env });
    await this.git.ensureBaseBranchAvailable(pullRequest.baseBranch, cwd);
    const rawDiff = await this.git.diffPullRequest(pullRequest.baseBranch, cwd);
    const changedFiles = classifyChangedFiles(parseGitDiffChangedFiles(rawDiff));
    const affectedRoutes = detectAffectedRoutes(changedFiles);
    const affectedSchemas = detectAffectedSchemas(changedFiles);

    return { pullRequest, rawDiff, changedFiles, affectedRoutes, affectedSchemas };
  }
}
