import { Injectable } from '@nestjs/common';

import type {
  ProjectMemoryKey,
  ProjectMemoryStorePort,
} from '../../application/ports/project-memory-store.port.js';
import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';
import { FileProjectMemoryAdapter } from './file-project-memory.adapter.js';
import { PostgresProjectMemoryAdapter } from './postgres-project-memory.adapter.js';

/**
 * Routes project memory to Postgres when DATABASE_URL is configured (CI), and to the
 * file fallback otherwise (local dev). Mirrors MemoryStoreRouterAdapter.
 */
@Injectable()
export class ProjectMemoryStoreRouterAdapter implements ProjectMemoryStorePort {
  constructor(
    private readonly fileStore: FileProjectMemoryAdapter,
    private readonly postgresStore: PostgresProjectMemoryAdapter,
  ) {}

  load(key: ProjectMemoryKey): Promise<ProjectKnowledge | null> {
    return this.resolveStore().load(key);
  }

  save(knowledge: ProjectKnowledge): Promise<void> {
    return this.resolveStore().save(knowledge);
  }

  private resolveStore(): ProjectMemoryStorePort {
    return process.env.DATABASE_URL?.trim() ? this.postgresStore : this.fileStore;
  }
}
