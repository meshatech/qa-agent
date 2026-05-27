import type { PrContextReadResult } from '../ports/github-actions-pr-context-reader.port.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export function buildPrDiffContextFromReadResult(result: PrContextReadResult): PrDiffContext {
  return {
    schemaVersion: 'pr-diff-context.v1',
    pullRequest: result.pullRequest,
    changedFiles: result.changedFiles,
    affectedRoutes: result.affectedRoutes,
    affectedSchemas: result.affectedSchemas,
  };
}
