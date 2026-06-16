import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Pool, type QueryResultRow } from 'pg';

import type { MemoryChunk, MemorySearchResponse } from '../../domain/schemas/memory.schema.js';
import { MemoryChunkSchema } from '../../domain/schemas/memory.schema.js';
import type {
  FailureFingerprint,
  ProjectScope,
  PromotedMemoryRecord,
  RecordFailureFingerprintInput,
} from '../../domain/schemas/memory-record.schema.js';
import type {
  MemoryStorePort,
  MemoryStoreSearchInput,
  MemoryStoreUpsertResult,
  MemoryWriteBack,
} from '../../application/ports/memory-store.port.js';
import { BM25MemoryIndex } from '../../application/services/bm25-memory-index.service.js';
import { runMemoryStoreMigrations } from './postgres-migration-runner.js';

const PROJECT_SCOPE_BOOST = 0.5;

const SEARCH_OVERFETCH_MULTIPLIER = 3;

interface MemoryChunkRow extends QueryResultRow {
  id: string;
  memory_type: string;
  title: string;
  content_markdown: string;
  route: string | null;
  component: string | null;
}

interface FingerprintRow extends QueryResultRow {
  project_id: string;
  failure_signature: string;
  route: string | null;
  component: string | null;
  broken_locator: string | null;
  first_seen_run_id: string;
  last_seen_run_id: string;
  occurrences: number;
  suggested_memory_id: string | null;
}

@Injectable()
export class PostgresMemoryStoreAdapter implements MemoryStorePort, OnModuleDestroy {
  private pool?: Pool;
  private migrated = false;

  async search(input: MemoryStoreSearchInput): Promise<MemorySearchResponse> {
    const pool = await this.getPool();
    const warnings: string[] = [];

    const types = input.types?.length ? input.types : null;
    const result = await pool.query<MemoryChunkRow>(
      `SELECT id, memory_type, title, content_markdown, route, component
       FROM agent_memory_chunks
       WHERE project_id = $1 AND promotion_status = 'promoted'
         AND ($2::text[] IS NULL OR memory_type = ANY($2))`,
      [input.project.projectId, types],
    );

    if (result.rows.length === 0) {
      return { chunks: [], warnings };
    }

    const chunks: MemoryChunk[] = result.rows.map((row) =>
      MemoryChunkSchema.parse({
        id: row.id,
        type: row.memory_type,
        title: row.title,
        content: row.content_markdown,
        sourceFile: 'postgres://agent_memory_chunks',
        metadata: { route: row.route ?? undefined, component: row.component ?? undefined },
      }),
    );

    const index = new BM25MemoryIndex();
    index.build(chunks);
    const scored = index.search(input.query, input.limit * SEARCH_OVERFETCH_MULTIPLIER);

    const boosted = scored.map((item) => {
      const route = item.chunk.metadata?.route;
      const component = item.chunk.metadata?.component;
      let boost = 0;
      if (input.project.route && route === input.project.route) boost += PROJECT_SCOPE_BOOST;
      if (input.project.component && component === input.project.component) boost += PROJECT_SCOPE_BOOST;
      return { ...item, relevanceScore: item.relevanceScore + boost };
    });

    boosted.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return { chunks: boosted.slice(0, input.limit), warnings };
  }

  async upsertPromoted(
    records: PromotedMemoryRecord[],
    options: { writeBack: MemoryWriteBack },
  ): Promise<MemoryStoreUpsertResult> {
    if (records.length === 0 || (options.writeBack !== 'db' && options.writeBack !== 'both')) {
      return { inserted: 0, updated: 0 };
    }

    const pool = await this.getPool();
    let inserted = 0;
    let updated = 0;

    for (const record of records) {
      const result = await pool.query<{ inserted: boolean }>(
        `INSERT INTO agent_memory_chunks (
           id, project_id, repo_url, memory_type, title, content_markdown,
           route, component, scenario_id, old_locator, new_locator,
           failure_signature, evidence_url, confidence, promotion_status,
           source_run_id, source_pr, source_commit_sha, content_hash, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now()
         )
         ON CONFLICT (content_hash) DO UPDATE SET
           title = EXCLUDED.title,
           content_markdown = EXCLUDED.content_markdown,
           route = EXCLUDED.route,
           component = EXCLUDED.component,
           scenario_id = EXCLUDED.scenario_id,
           old_locator = EXCLUDED.old_locator,
           new_locator = EXCLUDED.new_locator,
           failure_signature = EXCLUDED.failure_signature,
           evidence_url = EXCLUDED.evidence_url,
           confidence = EXCLUDED.confidence,
           promotion_status = EXCLUDED.promotion_status,
           source_run_id = EXCLUDED.source_run_id,
           source_pr = EXCLUDED.source_pr,
           source_commit_sha = EXCLUDED.source_commit_sha,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          record.id,
          record.projectId,
          record.repoUrl ?? null,
          record.type,
          record.title,
          record.content,
          record.route ?? null,
          record.component ?? null,
          record.scenarioId ?? null,
          record.oldLocator ?? null,
          record.newLocator ?? null,
          record.failureSignature ?? null,
          record.evidenceUrl ?? null,
          record.confidence,
          record.promotionStatus,
          record.sourceRunId,
          record.sourcePr ?? null,
          record.sourceCommitSha ?? null,
          record.contentHash,
        ],
      );

      if (result.rows[0]?.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }

    return { inserted, updated };
  }

  async findFailureFingerprint(signature: string, scope: ProjectScope): Promise<FailureFingerprint | null> {
    const pool = await this.getPool();
    const result = await pool.query<FingerprintRow>(
      `SELECT * FROM qa_failure_fingerprints WHERE project_id = $1 AND failure_signature = $2`,
      [scope.projectId, signature],
    );

    const row = result.rows[0];
    return row ? mapFingerprintRow(row) : null;
  }

  async recordFailureFingerprint(input: RecordFailureFingerprintInput): Promise<FailureFingerprint> {
    const pool = await this.getPool();
    const result = await pool.query<FingerprintRow>(
      `INSERT INTO qa_failure_fingerprints (
         project_id, failure_signature, route, component, broken_locator,
         first_seen_run_id, last_seen_run_id, occurrences, suggested_memory_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, 1, $7, now())
       ON CONFLICT (project_id, failure_signature) DO UPDATE SET
         occurrences = qa_failure_fingerprints.occurrences + 1,
         last_seen_run_id = EXCLUDED.last_seen_run_id,
         suggested_memory_id = COALESCE(EXCLUDED.suggested_memory_id, qa_failure_fingerprints.suggested_memory_id),
         updated_at = now()
       RETURNING *`,
      [
        input.projectId,
        input.failureSignature,
        input.route ?? null,
        input.component ?? null,
        input.brokenLocator ?? null,
        input.runId,
        input.suggestedMemoryId ?? null,
      ],
    );

    return mapFingerprintRow(result.rows[0]!);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      const connectionString = resolveDatabaseUrl(process.env.DATABASE_URL);
      if (!connectionString) {
        throw new Error('DATABASE_URL is not set; required for memory.source = "postgres" or "hybrid".');
      }
      this.pool = new Pool({ connectionString });
    }

    if (!this.migrated) {
      await runMemoryStoreMigrations(this.pool);
      this.migrated = true;
    }

    return this.pool;
  }
}

function resolveDatabaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (!raw.includes('host.docker.internal')) return raw;
  try {
    // Linux Docker does not resolve host.docker.internal by default.
    // Try to read the gateway IP from /proc/net/route (container → host).
    const route = readFileSync('/proc/net/route', 'utf8');
    const line = route.split('\n').find((l: string) => l.startsWith('eth0') || l.startsWith('ens'));
    if (line) {
      const gatewayHex = line.trim().split(/\s+/)[2];
      if (gatewayHex) {
        const octets = [
          parseInt(gatewayHex.slice(6, 8), 16),
          parseInt(gatewayHex.slice(4, 6), 16),
          parseInt(gatewayHex.slice(2, 4), 16),
          parseInt(gatewayHex.slice(0, 2), 16),
        ];
        const gatewayIp = octets.join('.');
        return raw.replace(/host\.docker\.internal/g, gatewayIp);
      }
    }
  } catch {
    // Fallback: leave host.docker.internal as-is and let DNS resolve it
  }
  return raw;
}

function mapFingerprintRow(row: FingerprintRow): FailureFingerprint {
  return {
    projectId: row.project_id,
    failureSignature: row.failure_signature,
    route: row.route ?? undefined,
    component: row.component ?? undefined,
    brokenLocator: row.broken_locator ?? undefined,
    firstSeenRunId: row.first_seen_run_id,
    lastSeenRunId: row.last_seen_run_id,
    occurrences: row.occurrences,
    suggestedMemoryId: row.suggested_memory_id ?? undefined,
  };
}
