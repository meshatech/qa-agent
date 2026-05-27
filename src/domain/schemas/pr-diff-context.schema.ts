import { z } from 'zod';

import type { PrContextReadResult } from '../../application/ports/github-actions-pr-context-reader.port.js';
import { ChangedFileSchema } from './changed-file.schema.js';
import { PullRequestContextSchema } from './pull-request-context.schema.js';

export const PrDiffContextSchema = z
  .object({
    schemaVersion: z.literal('pr-diff-context.v1'),
    pullRequest: PullRequestContextSchema,
    changedFiles: z.array(ChangedFileSchema),
    affectedRoutes: z.array(z.string()),
    affectedSchemas: z.array(z.string()),
  })
  .strict();

export type PrDiffContext = z.infer<typeof PrDiffContextSchema>;

export function buildPrDiffContextFromReadResult(result: PrContextReadResult): PrDiffContext {
  return {
    schemaVersion: 'pr-diff-context.v1',
    pullRequest: result.pullRequest,
    changedFiles: result.changedFiles,
    affectedRoutes: result.affectedRoutes,
    affectedSchemas: result.affectedSchemas,
  };
}
