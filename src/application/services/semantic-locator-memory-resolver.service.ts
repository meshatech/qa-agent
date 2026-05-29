import { Inject, Injectable } from '@nestjs/common';

import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';
import type { MemorySearchResult } from '../../domain/schemas/memory.schema.js';
import { MemorySearchService } from './memory-search.service.js';

/**
 * Resolves semantic locator candidates by searching the project's BM25 memory
 * for `semantic_locator` chunks that match an ExpectedOutcome.
 *
 * The search query is built from the outcome's description and target (both
 * originate from the demand), so no hardcoded word lists are required.
 * When memory returns no results, the caller falls back to its own strategy.
 */
@Injectable()
export class SemanticLocatorMemoryResolverService {
  constructor(
    @Inject(MemorySearchService) private readonly memorySearch: MemorySearchService,
  ) {}

  async resolveCandidates(
    outcome: ExpectedOutcome,
    projectPath?: string,
  ): Promise<string[]> {
    const query = this.buildQuery(outcome);
    const results = await this.memorySearch.search({
      projectPath,
      query,
      limit: 5,
      types: ['semantic_locator'],
    });
    return this.extractTexts(results.chunks);
  }

  private buildQuery(outcome: ExpectedOutcome): string {
    const parts = [outcome.description];
    if (outcome.target) parts.push(outcome.target);
    return parts.join(' ');
  }

  private extractTexts(results: MemorySearchResult[]): string[] {
    const texts = new Set<string>();
    for (const result of results) {
      // Use chunk title as a candidate
      texts.add(result.chunk.title);
      // Extract quoted strings from content (common pattern in memory docs)
      const matches = result.chunk.content.match(/"([^"]+)"/g);
      if (matches) {
        for (const m of matches) {
          texts.add(m.replace(/"/g, ''));
        }
      }
      // Extract bold labels (e.g. **Label**: `value`)
      const boldMatches = result.chunk.content.match(/\*\*([^*]+)\*\*/g);
      if (boldMatches) {
        for (const m of boldMatches) {
          texts.add(m.replace(/\*\*/g, ''));
        }
      }
    }
    return Array.from(texts).filter((t) => t.length > 0);
  }
}
