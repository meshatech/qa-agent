import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export interface PrDiffContextRunResult {
  context: PrDiffContext;
  contextPath: string;
}
