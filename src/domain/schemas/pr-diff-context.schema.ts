import { z } from 'zod';

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
