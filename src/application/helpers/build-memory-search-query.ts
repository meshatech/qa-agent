import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export function buildMemorySearchQuery(demand: DemandContext, prDiff: PrDiffContext): string {
  const parts: string[] = [...demand.acceptanceCriteria, ...prDiff.affectedRoutes, ...prDiff.affectedSchemas];
  const topPaths = prDiff.changedFiles.slice(0, 5).map((file) => file.path);
  parts.push(...topPaths);
  return parts.join(' ').trim();
}
