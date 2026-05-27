import type { ChangedFile } from '../schemas/changed-file.schema.js';
import {
  PrDiffContextSchema,
  type PrDiffContext,
} from '../schemas/pr-diff-context.schema.js';
import type { PullRequestContext } from '../schemas/pull-request-context.schema.js';

export interface ConsumedPrDiffContext {
  pullRequest: PullRequestContext;
  changedFiles: ChangedFile[];
  affectedRoutes: string[];
  affectedSchemas: string[];
  hasDiffSignal: boolean;
}

export function consumePrDiffContext(prDiff: PrDiffContext): ConsumedPrDiffContext {
  const validated = PrDiffContextSchema.parse(prDiff);
  const { pullRequest, changedFiles, affectedRoutes, affectedSchemas } = validated;

  return {
    pullRequest,
    changedFiles,
    affectedRoutes,
    affectedSchemas,
    hasDiffSignal:
      changedFiles.length > 0 || affectedRoutes.length > 0 || affectedSchemas.length > 0,
  };
}
