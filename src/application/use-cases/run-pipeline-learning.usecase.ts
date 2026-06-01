import { Inject, Injectable } from '@nestjs/common';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineLearningRunResult } from '../dto/pipeline-learning-result.dto.js';
import { LearningCandidateExtractorService, isEphemeralId } from '../services/learning-candidate-extractor.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { LearningCandidatesArtifactSchema } from '../../domain/schemas/learning-candidate.schema.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';

const EXECUTION_RESULT_FILE = 'execution-result.json';
const EXECUTION_PLAN_FILE = 'execution-plan.json';
const SELECTED_SCENARIOS_FILE = 'selected-scenarios.json';
const MEMORY_CONSULTATION_LOG_FILE = 'memory-consultation-log.json';
const LEARNING_CANDIDATES_FILE = 'learning-candidates.json';

@Injectable()
export class RunPipelineLearningUseCase {
  constructor(
    @Inject(LearningCandidateExtractorService) private readonly extractor: LearningCandidateExtractorService,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineLearningRunResult> {
    const _config = await this.loadConfig(options?.configPath ?? 'agent-qa.config.json');

    const executionResult = await this.readJsonSafe<Record<string, unknown>>(outputDir, EXECUTION_RESULT_FILE);
    const executionPlan = await this.readJsonSafe<Record<string, unknown>>(outputDir, EXECUTION_PLAN_FILE);
    const selectedScenarios = await this.readJsonSafe<{ scenarios?: unknown[] }>(outputDir, SELECTED_SCENARIOS_FILE);
    const memoryConsultationLog = await this.readJsonSafe<{ entries?: unknown[] }>(outputDir, MEMORY_CONSULTATION_LOG_FILE);

    const runId = this.extractRunId(outputDir);

    const candidates = this.extractor.extract({
      runId,
      executionResult: (executionResult ?? {}) as unknown as import('../services/learning-candidate-extractor.service.js').ExtractLearningCandidatesInput['executionResult'],
      executionPlan: (executionPlan ?? {}) as unknown as import('../services/learning-candidate-extractor.service.js').ExtractLearningCandidatesInput['executionPlan'],
      selectedScenarios: (selectedScenarios ?? { scenarios: [] }) as unknown as import('../services/learning-candidate-extractor.service.js').ExtractLearningCandidatesInput['selectedScenarios'],
      memoryConsultationLog: memoryConsultationLog as unknown as import('../services/learning-candidate-extractor.service.js').ExtractLearningCandidatesInput['memoryConsultationLog'] ?? undefined,
    });

    const artifact = LearningCandidatesArtifactSchema.parse({
      schemaVersion: 'learning-candidates.v1',
      runId,
      generatedAt: new Date().toISOString(),
      count: candidates.length,
      candidates,
    });

    const candidatesPath = resolve(join(outputDir, LEARNING_CANDIDATES_FILE));
    await writeFile(candidatesPath, JSON.stringify(artifact, null, 2), 'utf8');

    return {
      candidatesPath,
      count: candidates.length,
      confirmedCount: candidates.filter((c) => c.source === 'confirmed').length,
      inferredCount: candidates.filter((c) => c.source === 'inferred').length,
      gapCount: candidates.filter((c) => c.type === 'gap').length,
      semanticLocatorSuggestions: candidates.filter((c) => c.type === 'semantic_locator').length,
      hasEphemeralIdsFiltered: (Array.isArray(executionResult?.locatorTelemetry)
        ? (executionResult.locatorTelemetry as Array<{ elementId?: string }>)
        : []
      ).some((e) => isEphemeralId(e.elementId)),
    };
  }

  private async loadConfig(configPath: string) {
    const raw = await this.configLoader.load(configPath);
    return RunConfigSchema.parse(raw);
  }

  private async readJsonSafe<T>(dir: string, filename: string): Promise<T | undefined> {
    try {
      const content = await readFile(join(dir, filename), 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  private extractRunId(outputDir: string): string {
    // Use directory name or generate a timestamp-based runId
    const parts = outputDir.split(/[\\/]/);
    const last = parts[parts.length - 1] ?? 'run';
    if (last === 'pipeline') return `pipeline-${Date.now()}`;
    return `${last}-${Date.now()}`;
  }
}
