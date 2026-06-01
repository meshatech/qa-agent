import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';

import type { PipelineCorrelateRunResult } from '../dto/pipeline-correlate-result.dto.js';
import { buildMemorySearchQuery } from '../helpers/build-memory-search-query.js';
import {
  describePipelineArtifactError,
  readPipelineArtifact,
} from '../helpers/read-pipeline-artifact.js';
import { redactSecretsInMessage } from '../helpers/sanitize-token.js';
import type { CorrelationArtifactsWriterPort } from '../ports/correlation-artifacts-writer.port.js';
import type { MemoryConsultationLogWriterPort } from '../ports/memory-consultation-log-writer.port.js';
import { DemandContextPersistenceService } from '../services/demand-context-persistence.service.js';
import { DemandDiffMemoryCorrelatorService } from '../services/demand-diff-memory-correlator.service.js';
import { MemorySearchService } from '../services/memory-search.service.js';
import { ScenarioSelectorService } from '../services/scenario-selector.service.js';
import {
  ClickUpReaderError,
  ConfigError,
  CorrelationBlockedError,
  HarnessFatalError,
} from '../../domain/errors.js';
import {
  createBlockedCorrelationResult,
  type CorrelationResult,
} from '../../domain/schemas/correlation.schema.js';
import { PrDiffContextSchema, type PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { CorrelationReportContext } from '../../domain/helpers/correlation-report.renderer.js';
import {
  createMemoryConsultationLog,
  type MemoryChunkConsultation,
  type MemoryGap,
} from '../../domain/schemas/memory-consultation-log.schema.js';

@Injectable()
export class RunPipelineCorrelateUseCase {
  constructor(
    @Inject(DemandContextPersistenceService)
    private readonly demandPersistence: DemandContextPersistenceService,
    @Inject(DemandDiffMemoryCorrelatorService)
    private readonly correlator: DemandDiffMemoryCorrelatorService,
    @Inject(MemorySearchService) private readonly memorySearch: MemorySearchService,
    @Inject(ScenarioSelectorService) private readonly scenarioSelector: ScenarioSelectorService,
    @Inject('CorrelationArtifactsWriterPort')
    private readonly artifactsWriter: CorrelationArtifactsWriterPort,
    @Inject('MemoryConsultationLogWriterPort')
    private readonly memoryLogWriter: MemoryConsultationLogWriterPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { projectPath?: string; env?: NodeJS.ProcessEnv },
  ): Promise<PipelineCorrelateRunResult> {
    const env = options?.env ?? process.env;
    const token = env.CLICKUP_TOKEN?.trim() ?? '';
    const safeUserMessage = (message: string) => redactSecretsInMessage(message, [token]);

    let prDiff: PrDiffContext;
    try {
      prDiff = await readPipelineArtifact(outputDir, 'pr-diff-context.json', PrDiffContextSchema);
    } catch (error) {
      if (error instanceof ConfigError && error.message.includes('not found')) {
        return this.blockAndThrow(
          {
            blockReason: 'Pipeline artifact not found: pr-diff-context.json',
          },
          safeUserMessage,
        );
      }
      if (error instanceof ConfigError) {
        return this.blockAndThrow(
          {
            blockReason: safeUserMessage(describePipelineArtifactError(error)),
          },
          safeUserMessage,
        );
      }
      throw error;
    }
    const clickUpTaskId = prDiff.pullRequest.clickUpTaskId?.trim();

    if (!clickUpTaskId) {
      return this.blockAndThrow(
        {
          blockReason:
            'pullRequest.clickUpTaskId is missing; run pipeline prepare with a PR linked to ClickUp',
        },
        safeUserMessage,
      );
    }

    if (!token) {
      return this.blockAndThrow(
        {
          blockReason: 'CLICKUP_TOKEN is missing; cannot fetch demand context',
        },
        safeUserMessage,
      );
    }

    let demandContextPath: string;
    let demand;
    try {
      const persisted = await this.demandPersistence.persistFromClickUpTask(outputDir, token, {
        configTaskId: clickUpTaskId,
      });
      demandContextPath = persisted.path;
      demand = persisted.demand;
    } catch (error) {
      if (error instanceof ClickUpReaderError) {
        return this.blockAndThrow(
          {
            blockReason: safeUserMessage(`Failed to fetch demand from ClickUp: ${error.message}`),
          },
          safeUserMessage,
        );
      }
      if (error instanceof ZodError) {
        return this.blockAndThrow(
          {
            blockReason: safeUserMessage(`Invalid demand context schema: ${error.message}`),
          },
          safeUserMessage,
        );
      }
      throw new HarnessFatalError(
        safeUserMessage(error instanceof Error ? error.message : String(error)),
        error,
      );
    }

    let memoryQuery: string;
    try {
      memoryQuery = buildMemorySearchQuery(demand, prDiff);
    } catch (error) {
      if (error instanceof ZodError) {
        return this.blockAndThrow(
          {
            blockReason: safeUserMessage(`Invalid correlation input schema: ${error.message}`),
          },
          safeUserMessage,
        );
      }
      throw error;
    }

    let memoryResponse;
    try {
      memoryResponse = await this.memorySearch.search({
        query: memoryQuery,
        limit: 10,
        projectPath: options?.projectPath ?? process.cwd(),
        types: ['route', 'flow', 'scenario', 'semantic_locator'],
      });
    } catch (error) {
      return this.blockAndThrow(
        {
          blockReason: safeUserMessage(
            `Failed to search BM25 memory: ${error instanceof Error ? error.message : String(error)}`,
          ),
        },
        safeUserMessage,
      );
    }

    let result: CorrelationResult;
    try {
      result = this.correlator.correlate({
        demand,
        prDiff,
        memoryResults: memoryResponse.chunks,
        warnings: memoryResponse.warnings,
      });
    } catch (error) {
      return this.blockAndThrow(
        {
          blockReason: safeUserMessage(
            `Correlation failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
          warnings: memoryResponse.warnings,
        },
        safeUserMessage,
      );
    }

    const scenarioChunks = memoryResponse.chunks.filter((m) => m.chunk.type === 'scenario').map((m) => m.chunk);
    const selected = this.scenarioSelector.select({ requiredScenarios: result.scenarios, scenarioChunks });
    if (selected.warnings.length) {
      result.warnings.push(...selected.warnings);
    }

    const memoryLog = this.buildMemoryConsultationLog(memoryQuery, memoryResponse, result, prDiff);
    let memoryConsultationLogPath: string | undefined;
    try {
      memoryConsultationLogPath = await this.memoryLogWriter.write(outputDir, memoryLog);
    } catch (error) {
      result.warnings.push(
        `Failed to write memory consultation log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (result.status === 'BLOCKED') {
      throw new CorrelationBlockedError({
        ...result,
        blockReason: result.blockReason
          ? safeUserMessage(result.blockReason)
          : result.blockReason,
        warnings: result.warnings.map((warning) => safeUserMessage(warning)),
      });
    }

    const paths = await this.persistArtifacts(outputDir, result, selected.selectedScenarios, {
      demandTitle: demand.title,
      prNumber: prDiff.pullRequest.prNumber,
    });

    return {
      result,
      requiredScenariosPath: paths.requiredScenariosPath,
      correlationReportPath: paths.correlationReportPath,
      selectedScenariosPath: paths.selectedScenariosPath,
      demandContextPath,
      demand,
      memoryConsultationLogPath,
    };
  }

  private async persistArtifacts(
    outputDir: string,
    result: CorrelationResult,
    selectedScenarios: import('../../domain/models/run.model.js').QaScenario[],
    context: CorrelationReportContext,
  ) {
    return this.artifactsWriter.write(outputDir, result, selectedScenarios, context);
  }

  private buildMemoryConsultationLog(
    query: string,
    memoryResponse: import('../../domain/schemas/memory.schema.js').MemorySearchResponse,
    result: CorrelationResult,
    prDiff: PrDiffContext,
  ) {
    const usedChunkIds = new Set<string>();
    for (const corr of result.correlations) {
      if (corr.memoryChunk) {
        usedChunkIds.add(corr.memoryChunk);
      }
    }

    const chunks: MemoryChunkConsultation[] = memoryResponse.chunks.map((item) => {
      const chunk = item.chunk;
      let influence: MemoryChunkConsultation['influence'] = 'none';
      if (usedChunkIds.has(chunk.id)) {
        influence = chunk.type === 'scenario' ? 'scenario' : 'plan';
      } else if (chunk.type === 'scenario') {
        influence = 'scenario';
      }
      return {
        chunkId: chunk.id,
        chunkType: chunk.type,
        chunkTitle: chunk.title,
        relevanceScore: item.relevanceScore,
        influence,
        rationale: influence !== 'none' ? `Chunk ${chunk.id} influenced correlation` : undefined,
      };
    });

    const gaps: MemoryGap[] = [];
    for (const corr of result.correlations) {
      if (corr.score < 0.15) {
        gaps.push({
          description: `Acceptance criterion uncovered by memory or diff: "${corr.criterion}"`,
          criterion: corr.criterion,
        });
      }
    }

    for (const route of prDiff.affectedRoutes) {
      const hasRouteChunk = memoryResponse.chunks.some(
        (c) => c.chunk.type === 'route' && (c.chunk.content.includes(route) || c.chunk.title.includes(route)),
      );
      if (!hasRouteChunk) {
        gaps.push({
          description: `Affected route "${route}" has no aligned route memory chunk`,
          affectedRoute: route,
        });
      }
    }

    if (memoryResponse.chunks.length === 0) {
      gaps.push({
        description: 'BM25 memory search returned no chunks',
      });
    }

    return createMemoryConsultationLog({
      query,
      totalChunksReturned: memoryResponse.chunks.length,
      chunks,
      gaps,
      timestamp: new Date().toISOString(),
    });
  }

  private blockAndThrow(
    input: { blockReason: string; warnings?: string[] },
    sanitize: (message: string) => string,
  ): never {
    const result = createBlockedCorrelationResult(
      sanitize(input.blockReason),
      (input.warnings ?? []).map((warning) => sanitize(warning)),
    );
    throw new CorrelationBlockedError(result);
  }
}
