import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import type { MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
import type {
  FailureFingerprint,
  ProjectScope,
  PromotedMemoryRecord,
  RecordFailureFingerprintInput,
} from '../../domain/schemas/memory-record.schema.js';
import { createFailureFingerprint, mergeFailureFingerprint } from '../../domain/schemas/memory-record.schema.js';
import type {
  MemoryStorePort,
  MemoryStoreSearchInput,
  MemoryStoreUpsertResult,
  MemoryWriteBack,
} from '../../application/ports/memory-store.port.js';
import { MEMORY_HEADER_V1, MemoryMarkdownLoader } from '../../application/services/memory-markdown-loader.service.js';
import { MemorySearchService } from '../../application/services/memory-search.service.js';

const FINGERPRINTS_FILE = 'failure-fingerprints.json';

@Injectable()
export class FileMemoryStoreAdapter implements MemoryStorePort {
  constructor(
    private readonly memorySearch: MemorySearchService,
    private readonly loader: MemoryMarkdownLoader,
  ) {}

  async search(input: MemoryStoreSearchInput): Promise<MemorySearchResponse> {
    return this.memorySearch.search({
      projectPath: input.projectPath,
      memoryPath: input.memoryPath,
      query: input.query,
      limit: input.limit,
      types: input.types,
    });
  }

  async upsertPromoted(
    records: PromotedMemoryRecord[],
    options: { writeBack: MemoryWriteBack; projectPath?: string },
  ): Promise<MemoryStoreUpsertResult> {
    if (records.length === 0 || (options.writeBack !== 'commit' && options.writeBack !== 'both')) {
      return { inserted: 0, updated: 0 };
    }

    const projectPath = options.projectPath ?? '.';
    const memoryPath = this.loader.resolveMemoryPath(projectPath);
    const existing = await this.loader.load(memoryPath);

    const base = ensureHeaderV1(existing.text);
    const chunks = records.map(renderPromotedMemoryRecord).join('\n\n');
    const newContent = base ? `${base}\n\n${chunks}\n` : `${MEMORY_HEADER_V1}\n\n${chunks}\n`;

    await mkdir(dirname(memoryPath), { recursive: true });
    await writeFile(memoryPath, newContent, 'utf8');

    return { inserted: records.length, updated: 0 };
  }

  async findFailureFingerprint(signature: string, scope: ProjectScope): Promise<FailureFingerprint | null> {
    const fingerprints = await this.readFingerprints(scope);
    return fingerprints.find((fp) => fp.failureSignature === signature) ?? null;
  }

  async recordFailureFingerprint(input: RecordFailureFingerprintInput): Promise<FailureFingerprint> {
    const scope: ProjectScope = { projectId: input.projectId, route: input.route, component: input.component };
    const fingerprints = await this.readFingerprints(scope);

    const existing = fingerprints.find((fp) => fp.failureSignature === input.failureSignature);
    const record = existing
      ? mergeFailureFingerprint(existing, input)
      : createFailureFingerprint(input);

    if (!existing) {
      fingerprints.push(record);
    }

    await this.writeFingerprints(input.projectId, fingerprints);
    return record;
  }

  private fingerprintsPath(projectPath: string): string {
    return join(projectPath, '.agent-qa', FINGERPRINTS_FILE);
  }

  private async readFingerprints(scope: ProjectScope): Promise<FailureFingerprint[]> {
    const path = this.fingerprintsPath(scope.projectId);
    try {
      const text = await readFile(path, 'utf8');
      return JSON.parse(text) as FailureFingerprint[];
    } catch {
      return [];
    }
  }

  private async writeFingerprints(projectPath: string, fingerprints: FailureFingerprint[]): Promise<void> {
    const path = this.fingerprintsPath(projectPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(fingerprints, null, 2), 'utf8');
  }
}

function ensureHeaderV1(content: string): string {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  if (firstLine.trim() === MEMORY_HEADER_V1) {
    return content.trimEnd();
  }

  const trimmed = content.trim();
  return trimmed ? `${MEMORY_HEADER_V1}\n\n${trimmed}` : MEMORY_HEADER_V1;
}

function renderPromotedMemoryRecord(record: PromotedMemoryRecord): string {
  const lines = [
    `## ${record.title}`,
    '',
    `<!-- type: ${record.type} | id: ${record.id} -->`,
    record.content,
  ];
  return lines.join('\n');
}
