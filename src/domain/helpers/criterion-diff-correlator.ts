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

interface BestMatchState {
  bestScore: number;
  bestFile: string | undefined;
  bestRationale: string;
}

interface MatchCandidate {
  score: number;
  file: string | undefined;
  rationale: string;
}

export function correlateCriterionWithDiff(
  input: CriterionDiffCorrelationInput,
): CriterionDiffCorrelationResult {
  const criterionTokens = tokenize(input.criterion);
  let state: BestMatchState = {
    bestScore: 0,
    bestFile: undefined,
    bestRationale: 'No lexical overlap with changed files or affected routes',
  };

  for (const file of input.prDiff.changedFiles) {
    state = applyBestMatch(state, {
      score: scoreChangedFile(criterionTokens, file),
      file: file.path,
      rationale: `Criterion tokens overlap with changed file path ${file.path}`,
    });
  }

  for (const route of input.prDiff.affectedRoutes) {
    state = applyBestMatch(state, {
      score: scoreRouteMatch(criterionTokens, route),
      file: findChangedFileForRoute(input.prDiff.changedFiles, route),
      rationale: `Criterion tokens overlap with affected route ${route}`,
    });
  }

  for (const schema of input.prDiff.affectedSchemas) {
    const schemaMatch = scoreSchemaMatch(criterionTokens, schema, input.prDiff.changedFiles);
    state = applyBestMatch(state, {
      score: schemaMatch.score,
      file: schemaMatch.file,
      rationale: `Criterion tokens overlap with affected schema ${schema}`,
    });
  }

  let memoryChunk: string | undefined;
  const memoryBoost = applyMemoryBoost(criterionTokens, input.prDiff, input.memory);
  if (memoryBoost) {
    state.bestScore = Math.min(1, state.bestScore + memoryBoost.boost);
    memoryChunk = memoryBoost.chunkId;
    state.bestRationale = `${state.bestRationale}; ${memoryBoost.rationale}`;
  }

  const relatedFiles = collectRelatedFiles(criterionTokens, input.prDiff);
  return {
    correlation: createCorrelationItem({
      criterion: input.criterion,
      file: state.bestFile,
      memoryChunk,
      score: state.bestScore,
      rationale: state.bestRationale,
    }),
    relatedFiles,
  };
}

function applyBestMatch(state: BestMatchState, candidate: MatchCandidate): BestMatchState {
  if (candidate.score <= state.bestScore) {
    return state;
  }

  return {
    bestScore: candidate.score,
    bestFile: candidate.file,
    bestRationale: candidate.rationale,
  };
}

function scoreChangedFile(criterionTokens: Set<string>, file: ChangedFile): number {
  return overlapScore(criterionTokens, pathTokens(file.path));
}

function scoreRouteMatch(criterionTokens: Set<string>, route: string): number {
  return overlapScore(criterionTokens, tokenize(route));
}

function scoreSchemaMatch(
  criterionTokens: Set<string>,
  schemaId: string,
  changedFiles: ChangedFile[],
): { score: number; file: string | undefined } {
  const schemaFile = findChangedFileForSchema(changedFiles, schemaId);
  if (schemaFile) {
    return {
      score: overlapScore(criterionTokens, pathTokens(schemaFile)),
      file: schemaFile,
    };
  }

  return {
    score: overlapScore(criterionTokens, tokenize(`${schemaId} schema`)),
    file: undefined,
  };
}

function collectRelatedFiles(
  criterionTokens: Set<string>,
  prDiff: ConsumedPrDiffContext,
): string[] {
  const scored = new Map<string, number>();

  for (const file of prDiff.changedFiles) {
    const score = scoreChangedFile(criterionTokens, file);
    if (score > 0) {
      scored.set(file.path, Math.max(scored.get(file.path) ?? 0, score));
    }
  }

  for (const route of prDiff.affectedRoutes) {
    const score = scoreRouteMatch(criterionTokens, route);
    if (score > 0) {
      const routeFile = findChangedFileForRoute(prDiff.changedFiles, route);
      if (routeFile) {
        scored.set(routeFile, Math.max(scored.get(routeFile) ?? 0, score));
      }
    }
  }

  for (const schema of prDiff.affectedSchemas) {
    const schemaMatch = scoreSchemaMatch(criterionTokens, schema, prDiff.changedFiles);
    if (schemaMatch.score > 0 && schemaMatch.file) {
      scored.set(schemaMatch.file, Math.max(scored.get(schemaMatch.file) ?? 0, schemaMatch.score));
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

    if (!criterionHit) {
      continue;
    }

    const boost = routeHit
      ? Math.min(0.35, result.relevanceScore * 0.1 + 0.1)
      : Math.min(0.25, result.relevanceScore * 0.1 + 0.05);

    return {
      boost,
      chunkId: chunk.id,
      rationale: routeHit
        ? `BM25 memory chunk ${chunk.id} (${chunk.type}) aligns with affected routes and criterion`
        : `BM25 memory chunk ${chunk.id} (${chunk.type}) aligns with criterion`,
    };
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
  for (const file of changedFiles) {
    if (file.kind !== 'schema') {
      continue;
    }

    if (file.path.endsWith(`${schemaId}.schema.ts`)) {
      return file.path;
    }
  }

  const schemaTokens = pathTokens(schemaId);
  for (const file of changedFiles) {
    if (file.kind !== 'schema') {
      continue;
    }

    if (overlapScore(schemaTokens, pathTokens(file.path)) > 0) {
      return file.path;
    }
  }

  return undefined;
}
