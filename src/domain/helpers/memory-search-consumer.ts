import { z } from 'zod';

import {
  MemorySearchResultSchema,
  type MemorySearchResult,
} from '../schemas/memory.schema.js';

const CORRELATION_CHUNK_TYPES = new Set(['route', 'flow', 'scenario']);

export interface ConsumedMemorySearchContext {
  results: MemorySearchResult[];
  correlationChunks: MemorySearchResult[];
  isEmpty: boolean;
}

export function consumeMemorySearchResults(
  memoryResults: MemorySearchResult[],
): ConsumedMemorySearchContext {
  const results = z.array(MemorySearchResultSchema).parse(memoryResults);
  const correlationChunks = results.filter((result) =>
    CORRELATION_CHUNK_TYPES.has(result.chunk.type),
  );

  return {
    results,
    correlationChunks,
    isEmpty: results.length === 0,
  };
}
