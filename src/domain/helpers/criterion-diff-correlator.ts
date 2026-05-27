import { overlapScore, pathTokens, tokenize } from './correlation-lexical.js';
import type { ConsumedMemorySearchContext } from './memory-search-consumer.js';
import type { ConsumedPrDiffContext } from './pr-diff-context-consumer.js';
import { createCorrelationItem } from '../schemas/correlation-item.schema.js';
import type { CorrelationItem } from '../schemas/correlation.schema.js';
import type { ChangedFile } from '../schemas/changed-file.schema.js';

const MAX_RELATED_FILES = 5;

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
      const routeFile = findChangedFileForRoute(input.prDiff.changedFiles, route);
      bestFile = routeFile ?? bestFile;
      bestRationale = `Criterion tokens overlap with affected route ${route}`;
    }
  }

  for (const schema of input.prDiff.affectedSchemas) {
    const score = overlapScore(criterionTokens, pathTokens(schema));
    if (score > bestScore) {
      bestScore = score;
      const schemaFile = findChangedFileForSchema(input.prDiff.changedFiles, schema);
      bestFile = schemaFile ?? bestFile ?? schema;
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

  const relatedFiles = collectRelatedFiles(criterionTokens, input.prDiff);
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

function collectRelatedFiles(
  criterionTokens: Set<string>,
  prDiff: ConsumedPrDiffContext,
): string[] {
  const scored = new Map<string, number>();

  for (const file of prDiff.changedFiles) {
    const score = overlapScore(criterionTokens, pathTokens(file.path));
    if (score > 0) {
      scored.set(file.path, Math.max(scored.get(file.path) ?? 0, score));
    }
  }

  for (const route of prDiff.affectedRoutes) {
    const score = overlapScore(criterionTokens, tokenize(route));
    if (score > 0) {
      const routeFile = findChangedFileForRoute(prDiff.changedFiles, route);
      if (routeFile) {
        scored.set(routeFile, Math.max(scored.get(routeFile) ?? 0, score));
      }
    }
  }

  for (const schema of prDiff.affectedSchemas) {
    const score = overlapScore(criterionTokens, pathTokens(schema));
    if (score > 0) {
      const schemaFile = findChangedFileForSchema(prDiff.changedFiles, schema);
      if (schemaFile) {
        scored.set(schemaFile, Math.max(scored.get(schemaFile) ?? 0, score));
      }
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RELATED_FILES)
    .map(([path]) => path);
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

function findChangedFileForRoute(changedFiles: ChangedFile[], route: string): string | undefined {
  const routeTokens = pathTokens(route.startsWith('/') ? route.slice(1) : route);
  let bestMatch: { path: string; score: number } | undefined;

  for (const file of changedFiles) {
    if (file.kind !== 'route') {
      continue;
    }

    const score = overlapScore(routeTokens, pathTokens(file.path));
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { path: file.path, score };
    }
  }

  if (bestMatch) {
    return bestMatch.path;
  }

  const routeSlug = route.replace(/^\//, '').toLowerCase();
  if (!routeSlug) {
    return undefined;
  }

  return changedFiles.find(
    (file) => file.kind === 'route' && file.path.toLowerCase().includes(routeSlug),
  )?.path;
}

function findChangedFileForSchema(changedFiles: ChangedFile[], schemaId: string): string | undefined {
  const schemaTokens = pathTokens(schemaId);

  for (const file of changedFiles) {
    if (file.kind !== 'schema') {
      continue;
    }

    if (file.path.endsWith(`${schemaId}.schema.ts`)) {
      return file.path;
    }

    if (overlapScore(schemaTokens, pathTokens(file.path)) > 0) {
      return file.path;
    }
  }

  return undefined;
}
