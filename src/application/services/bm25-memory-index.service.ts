import { Injectable } from '@nestjs/common';

import type { MemoryChunk, MemorySearchResult } from '../../domain/schemas/memory.schema.js';

const K1 = 1.5;
const B = 0.75;

interface BuiltIndex {
  chunks: MemoryChunk[];
  docTokens: string[][];
  docLengths: number[];
  avgDocLength: number;
  documentFrequency: Map<string, number>;
  totalDocuments: number;
}

@Injectable()
export class BM25MemoryIndex {
  private index: BuiltIndex = {
    chunks: [],
    docTokens: [],
    docLengths: [],
    avgDocLength: 0,
    documentFrequency: new Map(),
    totalDocuments: 0,
  };

  build(chunks: MemoryChunk[]): void {
    const docTokens = chunks.map((chunk) => tokenize(`${chunk.title} ${chunk.content}`));
    const docLengths = docTokens.map((tokens) => tokens.length);
    const totalDocuments = chunks.length;
    const avgDocLength = docLengths.reduce((sum, length) => sum + length, 0) / (totalDocuments || 1);
    const documentFrequency = new Map<string, number>();

    for (const tokens of docTokens) {
      for (const term of new Set(tokens)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    this.index = {
      chunks,
      docTokens,
      docLengths,
      avgDocLength,
      documentFrequency,
      totalDocuments,
    };
  }

  search(query: string, limit: number): MemorySearchResult[] {
    if (!this.index.totalDocuments || !query.trim()) {
      return [];
    }

    const queryTerms = tokenize(query);
    if (!queryTerms.length) {
      return [];
    }

    const scored = this.index.chunks.map((chunk, docIndex) => ({
      chunk,
      relevanceScore: scoreDocument(queryTerms, docIndex, this.index),
    }));

    return scored
      .filter((item) => item.relevanceScore > 0)
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, limit);
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function scoreDocument(queryTerms: string[], docIndex: number, index: BuiltIndex): number {
  const tokens = index.docTokens[docIndex] ?? [];
  const docLength = index.docLengths[docIndex] ?? 0;
  const termFrequency = new Map<string, number>();

  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const frequency = termFrequency.get(term) ?? 0;
    if (!frequency) continue;

    const df = index.documentFrequency.get(term) ?? 0;
    const idf = Math.log((index.totalDocuments - df + 0.5) / (df + 0.5) + 1);
    const normalization = frequency + K1 * (1 - B + B * (docLength / (index.avgDocLength || 1)));
    score += idf * ((frequency * (K1 + 1)) / normalization);
  }

  return score;
}
