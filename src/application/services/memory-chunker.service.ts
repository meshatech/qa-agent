import { Injectable } from '@nestjs/common';

import {
  MemoryChunkSchema,
  MemoryChunkTypeSchema,
  type MemoryChunk,
  type MemoryChunkType,
} from '../../domain/schemas/memory.schema.js';
import { MemoryMarkdownLoader } from './memory-markdown-loader.service.js';

const CHUNK_METADATA_RE = /<!--\s*type:\s*(\w+)\s*\|\s*id:\s*([A-Z0-9-]+)(?:\s*\|[^>]*)?\s*-->/i;

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
    const result = this.parse(loaded.text, loaded.sourceFile, options);
    result.warnings.unshift(...loaded.warnings);
    return result;
  }

  async loadProject(projectPath = '.', options: MemoryChunkerOptions = {}): Promise<MemoryChunkerResult> {
    const loaded = await this.loader.loadProject(projectPath);
    const result = this.parse(loaded.text, loaded.sourceFile, options);
    result.warnings.unshift(...loaded.warnings);
    return result;
  }

  parse(text: string, sourceFile: string, options: MemoryChunkerOptions = {}): MemoryChunkerResult {
    const warnings: string[] = [];
    const allowedTypes = options.types?.length ? new Set(options.types) : undefined;
    const sections = text.split(/^## /m).slice(1);
    const chunks: MemoryChunk[] = [];
    const seenIds = new Set<string>();
    let rejectedCount = 0;

    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      const title = (lines.shift() ?? '').trim();
      if (!title) {
        warnings.push('Skipped memory section without title.');
        rejectedCount += 1;
        continue;
      }

      const body = lines.join('\n').trim();
      const metadataMatch = body.match(CHUNK_METADATA_RE);
      if (!metadataMatch) {
        warnings.push(`Skipped section "${title}" without chunk metadata.`);
        rejectedCount += 1;
        continue;
      }

      const parsedType = MemoryChunkTypeSchema.safeParse(metadataMatch[1]?.toLowerCase());
      if (!parsedType.success) {
        warnings.push(`Skipped section "${title}" with unknown chunk type "${metadataMatch[1]}".`);
        rejectedCount += 1;
        continue;
      }

      const id = metadataMatch[2]!.toUpperCase();
      if (seenIds.has(id)) {
        warnings.push(`Skipped section "${title}" with duplicate chunk id "${id}".`);
        rejectedCount += 1;
        continue;
      }
      seenIds.add(id);

      if (allowedTypes && !allowedTypes.has(parsedType.data)) {
        continue;
      }

      const content = body
        .replace(CHUNK_METADATA_RE, '')
        .replace(/^---\s*$/gm, '')
        .trim();

      const chunk = MemoryChunkSchema.parse({
        id,
        type: parsedType.data,
        title,
        content,
        sourceFile,
      });
      chunks.push(chunk);
    }

    if (rejectedCount > 0) {
      warnings.push(`Rejected ${rejectedCount} invalid memory chunk(s) out of ${sections.length} section(s).`);
    }

    return { chunks, warnings };
  }
}
