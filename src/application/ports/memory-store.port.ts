import type { MemoryChunkType, MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
import type {
  FailureFingerprint,
  ProjectScope,
  PromotedMemoryRecord,
  RecordFailureFingerprintInput,
} from '../../domain/schemas/memory-record.schema.js';

export type MemorySource = 'file' | 'postgres' | 'hybrid';
export type MemoryWriteBack = 'commit' | 'db' | 'both' | 'off';

export interface MemoryStoreSearchInput {
  projectPath?: string;
  memoryPath?: string;
  query: string;
  limit: number;
  types?: MemoryChunkType[];
  project: ProjectScope;
  source?: MemorySource;
}

export interface MemoryStoreUpsertResult {
  inserted: number;
  updated: number;
}

export interface MemoryStorePort {
  search(input: MemoryStoreSearchInput): Promise<MemorySearchResponse>;

  upsertPromoted(
    records: PromotedMemoryRecord[],
    options: { writeBack: MemoryWriteBack; projectPath?: string; source?: MemorySource },
  ): Promise<MemoryStoreUpsertResult>;

  findFailureFingerprint(signature: string, scope: ProjectScope, source?: MemorySource): Promise<FailureFingerprint | null>;

  recordFailureFingerprint(input: RecordFailureFingerprintInput, source?: MemorySource): Promise<FailureFingerprint>;
}
