import { access } from 'node:fs/promises';

import { Injectable } from '@nestjs/common';

import type { MemoryChunkType, MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
import { BM25MemoryIndex } from './bm25-memory-index.service.js';
import { MemoryChunker } from './memory-chunker.service.js';
import { MemoryMarkdownLoader } from './memory-markdown-loader.service.js';

export interface MemorySearchInput {
  projectPath?: string;
  memoryPath?: string;
  query: string;
  limit: number;
  types?: MemoryChunkType[];
}

@Injectable()
export class MemorySearchService {
  constructor(
    private readonly chunker: MemoryChunker,
    private readonly index: BM25MemoryIndex,
    private readonly loader: MemoryMarkdownLoader,
  ) {}

  async search(input: MemorySearchInput): Promise<MemorySearchResponse> {
    const projectPath = input.projectPath ?? '.';
    const memoryPath = input.memoryPath ?? this.loader.resolveMemoryPath(projectPath);
    const warnings: string[] = [];

    const exists = await fileExists(memoryPath);
    if (!exists) {
      return {
        chunks: [],
        warnings: [`Project memory file not found at ${memoryPath}. Continuing without memory context.`],
      };
    }

    const loaded = await this.loader.load(memoryPath);
    if (!loaded.text.trim()) {
      return {
        chunks: [],
        warnings: [`Project memory file is empty at ${memoryPath}. Continuing without memory context.`],
      };
    }

    const parsed = this.chunker.parse(loaded.text, memoryPath, { types: input.types });
    warnings.push(...parsed.warnings);

    if (!parsed.chunks.length) {
      warnings.push(`No searchable memory chunks found in ${memoryPath}. Continuing without memory context.`);
      return { chunks: [], warnings };
    }

    this.index.build(parsed.chunks);
    const chunks = this.index.search(input.query, input.limit);
    return { chunks, warnings };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
