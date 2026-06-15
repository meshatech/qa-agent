import { Injectable } from '@nestjs/common';

import type { MemoryChunk, MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
import type {
  FailureFingerprint,
  ProjectScope,
  PromotedMemoryRecord,
  RecordFailureFingerprintInput,
} from '../../domain/schemas/memory-record.schema.js';
import type {
  MemorySource,
  MemoryStorePort,
  MemoryStoreSearchInput,
  MemoryStoreUpsertResult,
  MemoryWriteBack,
} from '../../application/ports/memory-store.port.js';
import { BM25MemoryIndex } from '../../application/services/bm25-memory-index.service.js';
import { FileMemoryStoreAdapter } from './file-memory-store.adapter.js';
import { PostgresMemoryStoreAdapter } from './postgres-memory-store.adapter.js';

@Injectable()
export class HybridMemoryStoreAdapter implements MemoryStorePort {
  constructor(
    private readonly fileStore: FileMemoryStoreAdapter,
    private readonly postgresStore: PostgresMemoryStoreAdapter,
  ) {}

  async search(input: MemoryStoreSearchInput): Promise<MemorySearchResponse> {
    const [fileResult, postgresResult] = await Promise.all([
      this.fileStore.search(input),
      this.postgresStore.search(input),
    ]);

    const chunks = dedupeChunks([
      ...fileResult.chunks.map((item) => item.chunk),
      ...postgresResult.chunks.map((item) => item.chunk),
    ]);

    const warnings = [...fileResult.warnings, ...postgresResult.warnings];

    if (chunks.length === 0) {
      return { chunks: [], warnings };
    }

    const index = new BM25MemoryIndex();
    index.build(chunks);
    const scored = index.search(input.query, input.limit);

    return { chunks: scored, warnings };
  }

  async upsertPromoted(
    records: PromotedMemoryRecord[],
    options: { writeBack: MemoryWriteBack; projectPath?: string; source?: MemorySource },
  ): Promise<MemoryStoreUpsertResult> {
    const [fileResult, postgresResult] = await Promise.all([
      this.fileStore.upsertPromoted(records, options),
      this.postgresStore.upsertPromoted(records, options),
    ]);

    return {
      inserted: fileResult.inserted + postgresResult.inserted,
      updated: fileResult.updated + postgresResult.updated,
    };
  }

  async findFailureFingerprint(signature: string, scope: ProjectScope): Promise<FailureFingerprint | null> {
    return this.postgresStore.findFailureFingerprint(signature, scope);
  }

  async recordFailureFingerprint(input: RecordFailureFingerprintInput): Promise<FailureFingerprint> {
    return this.postgresStore.recordFailureFingerprint(input);
  }
}

function dedupeChunks(chunks: MemoryChunk[]): MemoryChunk[] {
  const seen = new Map<string, MemoryChunk>();
  for (const chunk of chunks) {
    const key = `${chunk.type}|${chunk.title}|${chunk.content}`;
    if (!seen.has(key)) {
      seen.set(key, chunk);
    }
  }
  return Array.from(seen.values());
}
