import { overlapScore, pathTokens, tokenize } from './correlation-lexical.js';
import type { ConsumedMemorySearchContext } from './memory-search-consumer.js';
import type { ConsumedPrDiffContext } from './pr-diff-context-consumer.js';
import { createCorrelationItem } from '../schemas/correlation-item.schema.js';
import type { CorrelationItem } from '../schemas/correlation.schema.js';

export interface CriterionDiffCorrelationInput {
  criterion: string;
  prDiff: ConsumedPrDiffContext;
  memory: ConsumedMemorySearchContext;
}

export interface CriterionDiffCorrelationResult {
  correlation: CorrelationItem;
  relatedFiles: string[];
}

export function correlateCriterionWithDiff(
  input: CriterionDiffCorrelationInput,
): CriterionDiffCorrelationResult {
  const criterionTokens = tokenize(input.criterion);
  let bestScore = 0;
  let bestFile: string | undefined;
  let bestRationale = 'No lexical overlap with changed files or affected routes';

  for (const file of input.prDiff.changedFiles) {
    const score = overlapScore(criterionTokens, pathTokens(file.path));
    if (score > bestScore) {
      bestScore = score;
      bestFile = file.path;
      bestRationale = `Criterion tokens overlap with changed file path ${file.path}`;
    }
  }

  for (const route of input.prDiff.affectedRoutes) {
    const score = overlapScore(criterionTokens, tokenize(route));
    if (score > bestScore) {
      bestScore = score;
      bestFile = undefined;
      bestRationale = `Criterion tokens overlap with affected route ${route}`;
    }
  }

  for (const schema of input.prDiff.affectedSchemas) {
    const score = overlapScore(criterionTokens, pathTokens(schema));
    if (score > bestScore) {
      bestScore = score;
      bestFile = schema;
      bestRationale = `Criterion tokens overlap with affected schema ${schema}`;
    }
  }

  let memoryChunk: string | undefined;
  const memoryBoost = applyMemoryBoost(criterionTokens, input.prDiff, input.memory);
  if (memoryBoost) {
    bestScore = Math.min(1, bestScore + memoryBoost.boost);
    memoryChunk = memoryBoost.chunkId;
    bestRationale = `${bestRationale}; ${memoryBoost.rationale}`;
  }

  const relatedFiles = bestFile ? [bestFile] : [];
  return {
    correlation: createCorrelationItem({
      criterion: input.criterion,
      file: bestFile,
      memoryChunk,
      score: bestScore,
      rationale: bestRationale,
    }),
    relatedFiles,
  };
}

function applyMemoryBoost(
  criterionTokens: Set<string>,
  prDiff: ConsumedPrDiffContext,
  memory: ConsumedMemorySearchContext,
): { boost: number; chunkId: string; rationale: string } | undefined {
  for (const result of memory.correlationChunks) {
    const chunk = result.chunk;
    const routeHit = prDiff.affectedRoutes.some(
      (route) =>
        chunk.content.includes(route) ||
        chunk.title.includes(route) ||
        overlapScore(tokenize(route), tokenize(chunk.content)) > 0,
    );
    const criterionHit = overlapScore(criterionTokens, tokenize(`${chunk.title} ${chunk.content}`)) > 0;

    if (routeHit || criterionHit) {
      return {
        boost: Math.min(0.35, result.relevanceScore * 0.1 + 0.1),
        chunkId: chunk.id,
        rationale: `BM25 memory chunk ${chunk.id} (${chunk.type}) aligns with affected routes or criterion`,
      };
    }
  }
  return undefined;
}
