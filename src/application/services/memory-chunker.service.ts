import { Injectable } from '@nestjs/common';

import {
  MemoryChunkSchema,
  MemoryChunkTypeSchema,
  type MemoryChunk,
  type MemoryChunkType,
} from '../../domain/schemas/memory.schema.js';
import { MemoryMarkdownLoader } from './memory-markdown-loader.service.js';

const CHUNK_METADATA_RE = /<!--\s*type:\s*(\w+)\s*\|\s*id:\s*([A-Z0-9-]+)\s*-->/i;

export interface MemoryChunkerOptions {
  types?: MemoryChunkType[];
}

export interface MemoryChunkerResult {
  chunks: MemoryChunk[];
  warnings: string[];
}

@Injectable()
export class MemoryChunker {
  constructor(private readonly loader: MemoryMarkdownLoader) {}

  async loadFromFile(memoryPath: string, options: MemoryChunkerOptions = {}): Promise<MemoryChunkerResult> {
    const loaded = await this.loader.load(memoryPath);
    return this.parse(loaded.text, loaded.sourceFile, options);
  }

  async loadProject(projectPath = '.', options: MemoryChunkerOptions = {}): Promise<MemoryChunkerResult> {
    const loaded = await this.loader.loadProject(projectPath);
    return this.parse(loaded.text, loaded.sourceFile, options);
  }

  parse(text: string, sourceFile: string, options: MemoryChunkerOptions = {}): MemoryChunkerResult {
    const warnings: string[] = [];
    const allowedTypes = options.types?.length ? new Set(options.types) : undefined;
    const sections = text.split(/^## /m).slice(1);
    const chunks: MemoryChunk[] = [];

    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      const title = (lines.shift() ?? '').trim();
      if (!title) {
        warnings.push('Skipped memory section without title.');
        continue;
      }

      const body = lines.join('\n').trim();
      const metadataMatch = body.match(CHUNK_METADATA_RE);
      if (!metadataMatch) {
        warnings.push(`Skipped section "${title}" without chunk metadata.`);
        continue;
      }

      const parsedType = MemoryChunkTypeSchema.safeParse(metadataMatch[1]?.toLowerCase());
      if (!parsedType.success) {
        warnings.push(`Skipped section "${title}" with unknown chunk type "${metadataMatch[1]}".`);
        continue;
      }

      if (allowedTypes && !allowedTypes.has(parsedType.data)) {
        continue;
      }

      const content = body
        .replace(CHUNK_METADATA_RE, '')
        .replace(/^---\s*$/gm, '')
        .trim();

      const chunk = MemoryChunkSchema.parse({
        id: metadataMatch[2]!.toUpperCase(),
        type: parsedType.data,
        title,
        content,
        sourceFile,
      });
      chunks.push(chunk);
    }

    return { chunks, warnings };
  }
}
