import { Inject, Injectable } from '@nestjs/common';
import { join, resolve } from 'node:path';

import type { PipelinePromoteLearningRunResult } from '../dto/pipeline-promote-learning-result.dto.js';
import { MemoryChunkRenderer } from '../services/memory-chunk-renderer.service.js';
import { MEMORY_HEADER_V1 } from '../services/memory-markdown-loader.service.js';
import { RunHistoryService } from '../services/run-history.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { MemoryStorePort } from '../ports/memory-store.port.js';
import { MemoryStoreRouterAdapter } from '../../infra/memory/memory-store-router.adapter.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';
import { computeContentHash, type PromotedMemoryRecord } from '../../domain/schemas/memory-record.schema.js';

const LEARNING_CANDIDATES_FILE = 'learning-candidates.json';
const PROMOTION_LOG_FILE = 'promotion-log.json';
const MEMORY_FILE = 'memory.md';
const AGENT_QA_DIR = '.agent-qa';

interface PromotionDecision {
  candidateId: string;
  approved: boolean;
  reason: string;
  timestamp: string;
}

@Injectable()
export class RunPipelinePromoteLearningUseCase {
  constructor(
    @Inject(MemoryChunkRenderer) private readonly renderer: MemoryChunkRenderer,
    @Inject('RunRepositoryPort') private readonly repository: RunRepositoryPort,
    @Inject(MemoryStoreRouterAdapter) private readonly memoryStore: MemoryStorePort,
    @Inject(RunHistoryService) private readonly runHistory: RunHistoryService,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { projectPath?: string; autoApprove?: boolean; configPath?: string },
  ): Promise<PipelinePromoteLearningRunResult> {
    const config = await this.loadConfig(options?.configPath ?? 'agent-qa.config.json');
    const projectPath = options?.projectPath ?? process.cwd();
    const autoApprove = options?.autoApprove ?? false;

    const memoryDir = resolve(join(projectPath, AGENT_QA_DIR));

    // 1. Load learning candidates
    const candidatesArtifact = await this.loadCandidates(outputDir);
    const candidates = candidatesArtifact?.candidates ?? [];

    // 2. Load existing memory
    const memoryPath = resolve(join(memoryDir, MEMORY_FILE));
    const existingMemory = await this.readMemorySafe(memoryDir) ?? '';

    // 3. Evaluate each candidate
    const decisions: PromotionDecision[] = [];
    const promotedChunks: string[] = [];
    const promotedRecords: PromotedMemoryRecord[] = [];
    const warnings: string[] = [];

    const passingRunIds = await this.loadPassingRunIds(projectPath);

    for (const candidate of candidates) {
      const decision = this.evaluateCandidate(candidate, existingMemory, autoApprove);
      decisions.push(decision);

      if (decision.approved) {
        const chunk = this.renderer.render(candidate);
        const chunkType = this.renderer.chunkType(candidate);
        const body = this.renderer.renderBody(candidate);

        if (chunk && chunkType && body) {
          promotedChunks.push(chunk);

          const title = candidate.description;
          promotedRecords.push({
            id: this.renderer.chunkId(candidate),
            projectId: projectPath,
            type: chunkType,
            title,
            content: body,
            scenarioId: candidate.scenarioId,
            confidence: candidate.confidence,
            promotionStatus: passingRunIds.has(candidate.runId) ? 'promoted' : 'candidate',
            sourceRunId: candidate.runId,
            contentHash: computeContentHash({ projectId: projectPath, type: chunkType, title, content: body }),
          });
        } else {
          warnings.push(`Could not convert candidate ${candidate.id} to memory chunk`);
        }
      }
    }

    // 4. Append promoted chunks to memory.md
    if (promotedChunks.length > 0) {
      const base = this.ensureHeaderV1(existingMemory);
      const newContent = base + '\n\n' + promotedChunks.join('\n\n');
      await this.repository.writeFile(memoryDir, MEMORY_FILE, newContent);
    }

    // 4b. Persist promoted memory to the configured memory store (db/hybrid)
    if (promotedRecords.length > 0) {
      const writeBack = config.memory.writeBack;
      const dbWriteBack = writeBack === 'db' || writeBack === 'both' ? 'db' : 'off';
      await this.memoryStore.upsertPromoted(promotedRecords, {
        writeBack: dbWriteBack,
        projectPath,
        source: config.memory.source,
      });
    }

    // 5. Write promotion log
    const promotionLogPath = resolve(join(outputDir, PROMOTION_LOG_FILE));
    await this.repository.writeFile(
      outputDir,
      PROMOTION_LOG_FILE,
      JSON.stringify(
        {
          schemaVersion: 'promotion-log.v1',
          generatedAt: new Date().toISOString(),
          totalCandidates: candidates.length,
          promotedCount: promotedChunks.length,
          rejectedCount: decisions.filter((d) => !d.approved).length,
          decisions,
        },
        null,
        2,
      ),
    );

    return {
      promotedPath: memoryPath,
      promotedCount: promotedChunks.length,
      rejectedCount: decisions.filter((d) => !d.approved).length,
      promotionLogPath,
      warnings,
    };
  }

  private evaluateCandidate(
    candidate: import('../../domain/schemas/learning-candidate.schema.js').LearningCandidate,
    existingMemory: string,
    autoApprove: boolean,
  ): PromotionDecision {
    const reasons: string[] = [];
    let approved = false;

    // Reject: ephemeral IDs in content
    if (/\bel_\d{3,}\b/.test(candidate.content)) {
      return {
        candidateId: candidate.id,
        approved: false,
        reason: 'REJECTED: contains ephemeral ID (el_*)',
        timestamp: new Date().toISOString(),
      };
    }

    // Reject: sensitive data patterns
    const sensitivePatterns = [/password\s*[:=]\s*['"`][^'"`]+['"`]/i, /token\s*[:=]\s*['"`][^'"`]+['"`]/i, /api[_-]?key/i];
    for (const pattern of sensitivePatterns) {
      if (pattern.test(candidate.content)) {
        return {
          candidateId: candidate.id,
          approved: false,
          reason: 'REJECTED: contains sensitive data',
          timestamp: new Date().toISOString(),
        };
      }
    }

    if (candidate.duplicateOfMemoryId) {
      return {
        candidateId: candidate.id,
        approved: false,
        reason: `REJECTED: duplicate (known failure fingerprint, see ${candidate.duplicateOfMemoryId})`,
        timestamp: new Date().toISOString(),
      };
    }

    // Reject: duplicate (already in memory)
    if (existingMemory.includes(candidate.id) || existingMemory.includes(candidate.description.slice(0, 30))) {
      return {
        candidateId: candidate.id,
        approved: false,
        reason: 'REJECTED: duplicate (already in memory)',
        timestamp: new Date().toISOString(),
      };
    }

    // Auto-approve rules
    if (autoApprove) {
      approved = candidate.confidence >= 0.8 && candidate.source === 'confirmed' && candidate.risk !== 'high';
      reasons.push(approved ? 'AUTO-APPROVED: high confidence confirmed candidate' : 'AUTO-REJECTED: low confidence or inferred');
    } else {
      // Manual review mode: approve only confirmed high-confidence candidates
      approved = candidate.source === 'confirmed' && candidate.confidence >= 0.85 && candidate.risk === 'low';
      reasons.push(approved ? 'APPROVED: confirmed, high confidence, low risk' : 'REJECTED: needs manual review');
    }

    return {
      candidateId: candidate.id,
      approved,
      reason: reasons.join('; '),
      timestamp: new Date().toISOString(),
    };
  }

  private ensureHeaderV1(content: string): string {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    if (firstLine.trim() === MEMORY_HEADER_V1) {
      return content;
    }

    const trimmed = content.trim();
    return trimmed ? `${MEMORY_HEADER_V1}\n\n${trimmed}` : MEMORY_HEADER_V1;
  }

  private async loadCandidates(outputDir: string): Promise<import('../../domain/schemas/learning-candidate.schema.js').LearningCandidatesArtifact | null> {
    try {
      return await this.repository.readJson(outputDir, LEARNING_CANDIDATES_FILE);
    } catch {
      return null;
    }
  }

  private async loadPassingRunIds(projectPath: string): Promise<Set<string>> {
    const entries = await this.runHistory.readLines(projectPath).catch(() => []);
    return new Set(entries.filter((entry) => entry.status === 'passed').map((entry) => entry.runId));
  }

  private async readMemorySafe(memoryDir: string): Promise<string | null> {
    try {
      return await this.repository.readFile(memoryDir, MEMORY_FILE);
    } catch {
      return null;
    }
  }

  private async loadConfig(configPath: string) {
    const raw = await this.configLoader.load(configPath);
    return applyBaseUrlOverride(RunConfigSchema.parse(raw));
  }
}
