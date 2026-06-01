import { Inject, Injectable } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelinePromoteLearningRunResult } from '../dto/pipeline-promote-learning-result.dto.js';
import { MemoryChunkRenderer } from '../services/memory-chunk-renderer.service.js';

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
  ) {}

  async execute(
    outputDir: string,
    options?: { projectPath?: string; autoApprove?: boolean },
  ): Promise<PipelinePromoteLearningRunResult> {
    const projectPath = options?.projectPath ?? process.cwd();
    const autoApprove = options?.autoApprove ?? false;

    // 1. Load learning candidates
    const candidatesArtifact = await this.loadCandidates(outputDir);
    const candidates = candidatesArtifact?.candidates ?? [];

    // 2. Load existing memory
    const memoryPath = resolve(join(projectPath, AGENT_QA_DIR, MEMORY_FILE));
    const existingMemory = await this.readFileSafe(memoryPath) ?? '';

    // 3. Evaluate each candidate
    const decisions: PromotionDecision[] = [];
    const promotedChunks: string[] = [];
    const warnings: string[] = [];

    for (const candidate of candidates) {
      const decision = this.evaluateCandidate(candidate, existingMemory, autoApprove);
      decisions.push(decision);

      if (decision.approved) {
        const chunk = this.renderer.render(candidate);
        if (chunk) {
          promotedChunks.push(chunk);
        } else {
          warnings.push(`Could not convert candidate ${candidate.id} to memory chunk`);
        }
      }
    }

    // 4. Append promoted chunks to memory.md
    if (promotedChunks.length > 0) {
      const newContent = promotedChunks.join('\n\n');
      await writeFile(memoryPath, existingMemory + '\n\n' + newContent, 'utf8');
    }

    // 5. Write promotion log
    const promotionLogPath = resolve(join(outputDir, PROMOTION_LOG_FILE));
    await writeFile(
      promotionLogPath,
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
      'utf8',
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
    if (/el_\d{3,}/.test(candidate.content)) {
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

  private async loadCandidates(outputDir: string): Promise<import('../../domain/schemas/learning-candidate.schema.js').LearningCandidatesArtifact | null> {
    try {
      const content = await readFile(join(outputDir, LEARNING_CANDIDATES_FILE), 'utf8');
      return JSON.parse(content) as import('../../domain/schemas/learning-candidate.schema.js').LearningCandidatesArtifact;
    } catch {
      return null;
    }
  }

  private async readFileSafe(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }
}
