import { Inject, Injectable } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { PipelineRiskRunResult } from '../dto/pipeline-risk-result.dto.js';
import { RiskClassifierService } from '../services/risk-classifier.service.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import { PrDiffContextSchema } from '../../domain/schemas/pr-diff-context.schema.js';

const PR_DIFF_CONTEXT_FILE = 'pr-diff-context.json';
const RISK_SCORE_FILE = 'risk-score.json';

@Injectable()
export class RunPipelineRiskUseCase {
  constructor(
    @Inject(RiskClassifierService) private readonly classifier: RiskClassifierService,
  ) {}

  async execute(
    outputDir: string,
    options?: { projectPath?: string },
  ): Promise<PipelineRiskRunResult> {
    const projectPath = options?.projectPath ?? process.cwd();

    // 1. Load pr-diff-context.json
    const prDiff = await readPipelineArtifact(outputDir, PR_DIFF_CONTEXT_FILE, PrDiffContextSchema);

    // 2. Load run history (best effort)
    const runHistory = await this.loadRunHistory(projectPath);

    // 3. Classify risk
    const score = this.classifier.classify(prDiff, runHistory);

    // 4. Save risk-score.json
    await this.classifier.save(outputDir, score);

    return {
      riskScorePath: resolve(join(outputDir, RISK_SCORE_FILE)),
      value: score.value,
      level: score.level,
      factorCount: score.factors.length,
      explanation: score.explanation,
    };
  }

  private async loadRunHistory(_projectPath: string): Promise<import('../ports/run-repository.port.js').RunHistoryEntry[]> {
    // Best-effort: try to read run-history.jsonl from .agent-qa
    try {
      const historyPath = join(_projectPath, '.agent-qa', 'run-history.jsonl');
      const content = await readFile(historyPath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      return lines.map((line) => {
        const entry = JSON.parse(line);
        return {
          runId: entry.runId ?? 'unknown',
          timestamp: entry.timestamp ?? new Date().toISOString(),
          status: entry.status ?? 'PASSED',
          totalSteps: entry.totalSteps ?? 0,
          totalScenarios: entry.totalScenarios ?? 0,
          candidateCount: entry.candidateCount ?? 0,
        };
      });
    } catch {
      return [];
    }
  }
}
