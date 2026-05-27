import { overlapScore, pathTokens, tokenize } from './correlation-lexical.js';
import type { ConsumedMemorySearchContext } from './memory-search-consumer.js';
import type { ConsumedPrDiffContext } from './pr-diff-context-consumer.js';
import { createRiskItem } from '../schemas/risk-item.schema.js';
import type { ChangedFile } from '../schemas/changed-file.schema.js';
import type { MemorySearchResult } from '../schemas/memory.schema.js';
import type { RiskItem } from '../schemas/correlation.schema.js';

export interface NegativeDiffRegressionInput {
  prDiff: ConsumedPrDiffContext;
  memory: ConsumedMemorySearchContext;
}

export function correlateNegativeDiffRegressions(
  input: NegativeDiffRegressionInput,
): RiskItem[] {
  const risks: RiskItem[] = [];

  for (const file of input.prDiff.changedFiles) {
    if (!file.negativeLines.length) {
      continue;
    }

    let description = `${file.negativeLines.length} removed line(s) in ${file.path} may indicate regression risk`;
    const alignedChunk = findAlignedMemoryChunk(file, input.prDiff, input.memory);
    if (alignedChunk) {
      const { chunk } = alignedChunk;
      description += `; may affect memory ${chunk.type} ${chunk.id} (${chunk.title})`;
    }

    risks.push(
      createRiskItem({
        severity: file.negativeLines.length > 5 ? 'HIGH' : 'MEDIUM',
        description,
        relatedFile: file.path,
        type: 'regression',
      }),
    );
  }

  return risks;
}

function findAlignedMemoryChunk(
  file: ChangedFile,
  prDiff: ConsumedPrDiffContext,
  memory: ConsumedMemorySearchContext,
): MemorySearchResult | undefined {
  const filePathTokens = pathTokens(file.path);
  let best: MemorySearchResult | undefined;

  for (const result of memory.correlationChunks) {
    const chunk = result.chunk;
    const chunkText = `${chunk.title} ${chunk.content}`;
    const pathHit = overlapScore(filePathTokens, tokenize(chunkText)) > 0;
    const routeHit = prDiff.affectedRoutes.some(
      (route) =>
        chunk.content.includes(route) ||
        chunk.title.includes(route) ||
        overlapScore(tokenize(route), tokenize(chunk.content)) > 0,
    );

    if (!pathHit && !routeHit) {
      continue;
    }

    if (!best || result.relevanceScore > best.relevanceScore) {
      best = result;
    }
  }

  return best;
}
