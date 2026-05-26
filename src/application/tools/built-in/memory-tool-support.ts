import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { MemorySearchResponse } from '../../../domain/schemas/memory.schema.js';
import { BM25MemoryIndex } from '../../services/bm25-memory-index.service.js';
import { MemoryChunker } from '../../services/memory-chunker.service.js';
import { MemoryMarkdownLoader } from '../../services/memory-markdown-loader.service.js';
import { MemorySearchService } from '../../services/memory-search.service.js';
import type { QaToolContext } from '../qa-tool-context.js';
import type { MemorySearchInput } from './contracts.js';

let defaultMemorySearch: MemorySearchService | undefined;

export function resolveMemorySearchService(context: QaToolContext): MemorySearchService {
  const candidate = context.metadata?.memorySearch;
  if (candidate && typeof candidate === 'object' && typeof (candidate as MemorySearchService).search === 'function') {
    return candidate as MemorySearchService;
  }
  defaultMemorySearch ??= new MemorySearchService(
    new MemoryChunker(new MemoryMarkdownLoader()),
    new BM25MemoryIndex(),
    new MemoryMarkdownLoader(),
  );
  return defaultMemorySearch;
}

export async function executeProjectMemorySearch(
  input: MemorySearchInput,
  context: QaToolContext,
): Promise<MemorySearchResponse> {
  const memorySearch = resolveMemorySearchService(context);
  return memorySearch.search({
    projectPath: input.projectPath,
    memoryPath: input.memoryPath,
    query: input.query,
    limit: input.limit,
    types: input.types,
  });
}

export async function fetchMemoryContextForConfig(
  config: RunConfig,
  context: QaToolContext,
  limit = 5,
): Promise<MemorySearchResponse> {
  const query = [config.demand.title, config.demand.description]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);

  return executeProjectMemorySearch({ query, projectPath: '.', limit }, context);
}
