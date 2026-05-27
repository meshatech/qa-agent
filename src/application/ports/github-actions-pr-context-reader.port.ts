import type { ChangedFile } from '../../domain/schemas/changed-file.schema.js';
import type { PullRequestContext } from '../../domain/schemas/pull-request-context.schema.js';

export interface PrContextReadResult {
  pullRequest: PullRequestContext;
  rawDiff: string;
  changedFiles: ChangedFile[];
}

export interface GitHubActionsPrContextReaderPort {
  read(options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<PrContextReadResult>;
}
