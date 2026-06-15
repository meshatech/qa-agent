import { Injectable } from '@nestjs/common';

import type { MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
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
import { FileMemoryStoreAdapter } from './file-memory-store.adapter.js';
import { PostgresMemoryStoreAdapter } from './postgres-memory-store.adapter.js';
import { HybridMemoryStoreAdapter } from './hybrid-memory-store.adapter.js';

@Injectable()
export class MemoryStoreRouterAdapter implements MemoryStorePort {
  constructor(
    private readonly fileStore: FileMemoryStoreAdapter,
    private readonly postgresStore: PostgresMemoryStoreAdapter,
    private readonly hybridStore: HybridMemoryStoreAdapter,
  ) {}

  search(input: MemoryStoreSearchInput): Promise<MemorySearchResponse> {
    const source: MemorySource = input.source ?? 'file';
    if (source === 'postgres') return this.postgresStore.search(input);
    if (source === 'hybrid') return this.hybridStore.search(input);
    return this.fileStore.search(input);
  }

  upsertPromoted(
    records: PromotedMemoryRecord[],
    options: { writeBack: MemoryWriteBack; projectPath?: string; source?: MemorySource },
  ): Promise<MemoryStoreUpsertResult> {
    if (options.writeBack === 'off') {
      return Promise.resolve({ inserted: 0, updated: 0 });
    }
    if (options.writeBack === 'commit') return this.fileStore.upsertPromoted(records, options);
    if (options.writeBack === 'db') return this.postgresStore.upsertPromoted(records, options);
    return this.hybridStore.upsertPromoted(records, options);
  }

  findFailureFingerprint(signature: string, scope: ProjectScope, source?: MemorySource): Promise<FailureFingerprint | null> {
    if ((source ?? 'file') === 'file') return this.fileStore.findFailureFingerprint(signature, scope);
    return this.postgresStore.findFailureFingerprint(signature, scope);
  }

  recordFailureFingerprint(input: RecordFailureFingerprintInput, source?: MemorySource): Promise<FailureFingerprint> {
    if ((source ?? 'file') === 'file') return this.fileStore.recordFailureFingerprint(input);
    return this.postgresStore.recordFailureFingerprint(input);
  }
}
