import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';

import type {
  ProjectMemoryKey,
  ProjectMemoryStorePort,
} from '../../application/ports/project-memory-store.port.js';
import {
  ProjectKnowledgeSchema,
  type ProjectKnowledge,
} from '../../domain/schemas/project-knowledge.schema.js';
import { resolveDatabaseUrl } from './resolve-database-url.js';
import { runProjectMemoryMigrations } from './postgres-project-memory-migration-runner.js';

interface ProjectKnowledgeRow extends QueryResultRow {
  knowledge_json: unknown;
}

@Injectable()
export class PostgresProjectMemoryAdapter implements ProjectMemoryStorePort, OnModuleDestroy {
  private pool?: Pool;
  private migrated = false;

  async load(key: ProjectMemoryKey): Promise<ProjectKnowledge | null> {
    const pool = await this.getPool();
    const result = await pool.query<ProjectKnowledgeRow>(
      `SELECT knowledge_json FROM agent_project_knowledge WHERE repo = $1 AND branch = $2`,
      [key.repo, key.branch],
    );
    const row = result.rows[0];
    if (!row) return null;
    return ProjectKnowledgeSchema.parse(row.knowledge_json);
  }

  async save(knowledge: ProjectKnowledge): Promise<void> {
    const pool = await this.getPool();
    const { repo, branch, analyzedAt, commitSha, confidence } = knowledge.metadata;
    await pool.query(
      `INSERT INTO agent_project_knowledge (
         repo, branch, schema_version, knowledge_json, analyzed_at, commit_sha, confidence, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (repo, branch) DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         knowledge_json = EXCLUDED.knowledge_json,
         analyzed_at = EXCLUDED.analyzed_at,
         commit_sha = EXCLUDED.commit_sha,
         confidence = EXCLUDED.confidence,
         updated_at = now()`,
      [repo, branch, knowledge.schemaVersion, knowledge, analyzedAt, commitSha ?? null, confidence],
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      const connectionString = resolveDatabaseUrl(process.env.DATABASE_URL);
      if (!connectionString) {
        throw new Error('DATABASE_URL is not set; required for Postgres project memory.');
      }
      this.pool = new Pool({ connectionString });
    }

    if (!this.migrated) {
      await runProjectMemoryMigrations(this.pool);
      this.migrated = true;
    }

    return this.pool;
  }
}
