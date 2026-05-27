import { z } from 'zod';

export const PullRequestContextSchema = z
  .object({
    prNumber: z.number().int().positive(),
    baseBranch: z.string().min(1),
    headBranch: z.string().min(1),
    title: z.string().min(1),
    author: z.string().min(1),
    clickUpTaskId: z.string().min(1),
  })
  .strict();

export type PullRequestContext = z.infer<typeof PullRequestContextSchema>;
