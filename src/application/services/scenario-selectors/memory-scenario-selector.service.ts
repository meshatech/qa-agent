import { Inject, Injectable } from '@nestjs/common';

import type { MemoryChunk, MemorySearchResult } from '../../../domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../../../domain/schemas/correlation.schema.js';
import type { ScenarioCatalogItem } from '../../../domain/models/scenario-catalog-item.model.js';
import type { QaScenario, QaTask, ScenarioIntent } from '../../../domain/models/run.model.js';
import { MemorySearchService } from '../memory-search.service.js';
import { mapScenarioChunkToCatalogItem } from '../../mappers/chunk-to-scenario-catalog-item.mapper.js';
import { truncate } from '../../../domain/helpers/text-utils.js';
import { tokenize, intersectionSize } from '../../../domain/helpers/lexical-overlap.js';

const DEFAULT_SEARCH_LIMIT = 5;
const MIN_MATCH_SCORE = 0.25;
const MAX_SELECTED_SCENARIOS = 10;

export interface ScenarioMatch {
  requiredId: string;
  matchedChunkId: string;
  score: number;
}

export interface MemorySelectorInput {
  requiredScenarios: RequiredScenario[];
  scenarioChunks: MemoryChunk[];
}

export interface MemorySelectorResult {
  selectedScenarios: QaScenario[];
  warnings: string[];
  metadata: ScenarioMatch[];
}

@Injectable()
export class MemoryScenarioSelector {
  constructor(
    @Inject(MemorySearchService)
    private readonly memorySearch: MemorySearchService,
  ) {}

  async findCatalogItems(input: {
    requiredScenarios: RequiredScenario[];
    limitPerRequiredScenario?: number;
  }): Promise<ScenarioCatalogItem[]> {
    const limit = input.limitPerRequiredScenario ?? DEFAULT_SEARCH_LIMIT;

    const queries = input.requiredScenarios.map((required) => ({
      required,
      query: this.buildQuery(required),
    }));

    const searches = queries
      .filter((q) => q.query.trim().length > 0)
      .map(async (q) =>
        this.memorySearch.search({
          query: q.query,
          limit,
          types: ['scenario'],
        }),
      );

    const responses = await Promise.all(searches);
    const allResults = responses.flatMap((r) => r.chunks);

    const bestByChunkId = this.deduplicateByBestScore(allResults);

    const sorted = Array.from(bestByChunkId.values()).sort((a, b) => b.score - a.score);

    return sorted.map((item) => mapScenarioChunkToCatalogItem(item.chunk));
  }

  select(input: MemorySelectorInput): MemorySelectorResult {
    const warnings: string[] = [];
    const metadata: ScenarioMatch[] = [];

    if (!input.requiredScenarios.length) {
      warnings.push('No RequiredScenario provided; selection skipped.');
      return { selectedScenarios: [], warnings, metadata };
    }

    if (!input.scenarioChunks.length) {
      warnings.push('No scenario chunks available in memory catalog; selection skipped.');
      return { selectedScenarios: [], warnings, metadata };
    }

    const scoredMatches = this.scoreMatches(input.requiredScenarios, input.scenarioChunks);
    const filtered = scoredMatches.filter((m) => m.score >= MIN_MATCH_SCORE);

    for (const required of input.requiredScenarios) {
      const hasMatch = filtered.some((m) => m.requiredId === required.id);
      if (!hasMatch) {
        warnings.push(`No scenario matched RequiredScenario "${required.id}". Using fallback generation.`);
      }
    }

    const deduped = this.deduplicateByChunkId(filtered);
    const limited = deduped.slice(0, MAX_SELECTED_SCENARIOS);

    const selectedScenarios = limited.map((match) => this.chunkToScenario(match.chunk));
    metadata.push(...limited.map((m) => ({ requiredId: m.requiredId, matchedChunkId: m.chunk.id, score: m.score })));

    return { selectedScenarios, warnings, metadata };
  }

  private scoreMatches(
    requiredScenarios: RequiredScenario[],
    chunks: MemoryChunk[],
  ): Array<{ requiredId: string; chunk: MemoryChunk; score: number }> {
    const results: Array<{ requiredId: string; chunk: MemoryChunk; score: number }> = [];

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

  private deduplicateByChunkId(
    matches: Array<{ requiredId: string; chunk: MemoryChunk; score: number }>,
  ): Array<{ requiredId: string; chunk: MemoryChunk; score: number }> {
    const seen = new Set<string>();
    return matches.filter((m) => {
      if (seen.has(m.chunk.id)) return false;
      seen.add(m.chunk.id);
      return true;
    });
  }

  private chunkToScenario(chunk: MemoryChunk): QaScenario {
    const intent = this.extractIntent(chunk.metadata?.intent);

    const task: QaTask = {
      id: 'T001',
      title: chunk.title,
      expected: truncate(chunk.content, 200),
      status: 'PENDING',
      intent,
    };

    return {
      id: chunk.id,
      title: chunk.title,
      status: 'PLANNED',
      intent,
      tasks: [task],
    };
  }

  private extractIntent(raw: unknown): ScenarioIntent {
    const valid: ScenarioIntent[] = ['POSITIVE', 'NEGATIVE', 'EDGE', 'EXPLORATORY'];
    if (typeof raw === 'string' && valid.includes(raw as ScenarioIntent)) {
      return raw as ScenarioIntent;
    }
    return 'POSITIVE';
  }

  private buildQuery(required: RequiredScenario): string {
    const parts: string[] = [required.title, required.rationale];
    if (required.relatedFiles?.length) {
      parts.push(...required.relatedFiles);
    }
    return parts.filter(Boolean).join(' ');
  }

  private deduplicateByBestScore(
    results: MemorySearchResult[],
  ): Map<string, { chunk: MemoryChunk; score: number }> {
    const map = new Map<string, { chunk: MemoryChunk; score: number }>();

    for (const result of results) {
      if (!this.isScenarioChunk(result.chunk)) continue;

      const existing = map.get(result.chunk.id);
      if (!existing || result.relevanceScore > existing.score) {
        map.set(result.chunk.id, { chunk: result.chunk, score: result.relevanceScore });
      }
    }

    return map;
  }

  private isScenarioChunk(chunk: MemoryChunk): boolean {
    if (chunk.type === 'scenario') return true;
    const metaType = chunk.metadata?.type;
    if (typeof metaType === 'string' && metaType === 'scenario') return true;
    return false;
  }
}
