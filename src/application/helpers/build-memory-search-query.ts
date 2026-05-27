import { consumeDemandContext } from '../../domain/helpers/demand-context-consumer.js';
import { consumePrDiffContext } from '../../domain/helpers/pr-diff-context-consumer.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export function buildMemorySearchQuery(demand: DemandContext, prDiff: PrDiffContext): string {
  const consumedPrDiff = consumePrDiffContext(prDiff);
  const parts: string[] = [
    ...consumeDemandContext(demand).acceptanceCriteria,
    ...consumedPrDiff.affectedRoutes,
    ...consumedPrDiff.affectedSchemas,
  ];
  const topPaths = consumedPrDiff.changedFiles.slice(0, 5).map((file) => file.path);
  parts.push(...topPaths);
  return parts.join(' ').trim();
}
