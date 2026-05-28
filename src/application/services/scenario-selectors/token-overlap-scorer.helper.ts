import type { RequiredScenario } from '../../../domain/schemas/correlation.schema.js';
import type { MemoryChunk } from '../../../domain/schemas/memory.schema.js';
import { tokenize, intersectionSize } from '../../../domain/helpers/lexical-overlap.js';

export interface ScoredMatch {
  requiredId: string;
  chunk: MemoryChunk;
  score: number;
}

/**
 * Scores each chunk against each required scenario using token overlap (Jaccard).
 * This is a local, deterministic scorer that does not require an index.
 * For BM25-based ranked search, use MemorySearchService instead.
 */
export function scoreMatchesByTokenOverlap(
  requiredScenarios: RequiredScenario[],
  chunks: MemoryChunk[],
): ScoredMatch[] {
  const results: ScoredMatch[] = [];

  for (const required of requiredScenarios) {
    const queryTokens = tokenize(`${required.title} ${required.rationale}`);
    if (queryTokens.size === 0) continue;

    for (const chunk of chunks) {
      const docTokens = tokenize(`${chunk.title}\n${chunk.content}`);
      if (docTokens.size === 0) continue;

      const overlap = intersectionSize(queryTokens, docTokens);
      const unionSize = new Set([...queryTokens, ...docTokens]).size;
      const score = unionSize > 0 ? overlap / unionSize : 0;

      results.push({ requiredId: required.id, chunk, score });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
}
