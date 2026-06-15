import { access } from 'node:fs/promises';

import { Injectable } from '@nestjs/common';

function safeLog(message: string): void {
  console.log(`[MemorySearchService] ${message}`);
}

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

    safeLog(`search: query="${input.query.slice(0, 120)}" limit=${input.limit} path=${memoryPath}`);

    const exists = await fileExists(memoryPath);
    if (!exists) {
      safeLog('memory file not found, returning empty');
      return {
        chunks: [],
        warnings: [`Project memory file not found at ${memoryPath}. Continuing without memory context.`],
      };
    }

    const loaded = await this.loader.load(memoryPath);
    warnings.push(...loaded.warnings);
    if (!loaded.text.trim()) {
      safeLog('memory file is empty, returning empty');
      return {
        chunks: [],
        warnings: [`Project memory file is empty at ${memoryPath}. Continuing without memory context.`],
      };
    }

    const parsed = this.chunker.parse(loaded.text, memoryPath, { types: input.types });
    warnings.push(...parsed.warnings);

    if (!parsed.chunks.length) {
      warnings.push(`No searchable memory chunks found in ${memoryPath}. Continuing without memory context.`);
      safeLog('no searchable chunks found, returning empty');
      return { chunks: [], warnings };
    }

    this.index.build(parsed.chunks);
    const chunks = this.index.search(input.query, input.limit);
    safeLog(`search complete: chunks=${chunks.length} (total indexed=${parsed.chunks.length})`);
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
