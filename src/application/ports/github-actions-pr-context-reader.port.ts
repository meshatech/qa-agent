import type { PullRequestContext } from '../../domain/schemas/pull-request-context.schema.js';

export interface PrContextReadResult {
  pullRequest: PullRequestContext;
  rawDiff: string;
}

export interface GitHubActionsPrContextReaderPort {
  read(options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<PrContextReadResult>;
}
