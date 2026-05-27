import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';

import type { PipelineCorrelateRunResult } from '../dto/pipeline-correlate-result.dto.js';
import { buildMemorySearchQuery } from '../helpers/build-memory-search-query.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import type { CorrelationArtifactsWriterPort } from '../ports/correlation-artifacts-writer.port.js';
import { DemandContextPersistenceService } from '../services/demand-context-persistence.service.js';
import { DemandDiffMemoryCorrelatorService } from '../services/demand-diff-memory-correlator.service.js';
import { MemorySearchService } from '../services/memory-search.service.js';
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

@Injectable()
export class RunPipelineCorrelateUseCase {
  constructor(
    @Inject(DemandContextPersistenceService)
    private readonly demandPersistence: DemandContextPersistenceService,
    @Inject(DemandDiffMemoryCorrelatorService)
    private readonly correlator: DemandDiffMemoryCorrelatorService,
    @Inject(MemorySearchService) private readonly memorySearch: MemorySearchService,
    @Inject('CorrelationArtifactsWriterPort')
    private readonly artifactsWriter: CorrelationArtifactsWriterPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { projectPath?: string; env?: NodeJS.ProcessEnv },
  ): Promise<PipelineCorrelateRunResult> {
    const env = options?.env ?? process.env;
    let prDiff: PrDiffContext;
    try {
      prDiff = await readPipelineArtifact(outputDir, 'pr-diff-context.json', PrDiffContextSchema);
    } catch (error) {
      if (error instanceof ConfigError && error.message.includes('not found')) {
        return this.blockAndThrow(outputDir, {
          blockReason: 'Pipeline artifact not found: pr-diff-context.json',
        });
      }
      if (error instanceof ConfigError) {
        throw new HarnessFatalError(error.message, error);
      }
      throw error;
    }
    const clickUpTaskId = prDiff.pullRequest.clickUpTaskId?.trim();

    if (!clickUpTaskId) {
      return this.blockAndThrow(outputDir, {
        prNumber: prDiff.pullRequest.prNumber,
        blockReason:
          'pullRequest.clickUpTaskId is missing; run pipeline prepare with a PR linked to ClickUp',
      });
    }

    const token = env.CLICKUP_TOKEN?.trim() ?? '';
    if (!token) {
      return this.blockAndThrow(outputDir, {
        prNumber: prDiff.pullRequest.prNumber,
        blockReason: 'CLICKUP_TOKEN is missing; cannot fetch demand context',
      });
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
        return this.blockAndThrow(outputDir, {
          prNumber: prDiff.pullRequest.prNumber,
          blockReason: `Failed to fetch demand from ClickUp: ${error.message}`,
        });
      }
      if (error instanceof ZodError) {
        return this.blockAndThrow(outputDir, {
          prNumber: prDiff.pullRequest.prNumber,
          blockReason: `Invalid demand context schema: ${error.message}`,
        });
      }
      throw new HarnessFatalError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }

    let memoryQuery: string;
    try {
      memoryQuery = buildMemorySearchQuery(demand, prDiff);
    } catch (error) {
      if (error instanceof ZodError) {
        return this.blockAndThrow(outputDir, {
          prNumber: prDiff.pullRequest.prNumber,
          blockReason: `Invalid correlation input schema: ${error.message}`,
        });
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
      return this.blockAndThrow(outputDir, {
        prNumber: prDiff.pullRequest.prNumber,
        blockReason: `Failed to search BM25 memory: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const result = this.correlator.correlate({
      demand,
      prDiff,
      memoryResults: memoryResponse.chunks,
      warnings: memoryResponse.warnings,
    });

    const paths = await this.persistArtifacts(outputDir, result, {
      demandTitle: demand.title,
      prNumber: prDiff.pullRequest.prNumber,
    });

    if (result.status === 'BLOCKED') {
      throw new CorrelationBlockedError(result, paths.requiredScenariosPath, paths.correlationReportPath);
    }

    return {
      result,
      requiredScenariosPath: paths.requiredScenariosPath,
      correlationReportPath: paths.correlationReportPath,
      demandContextPath,
      demand,
    };
  }

  private async persistArtifacts(
    outputDir: string,
    result: CorrelationResult,
    context: CorrelationReportContext,
  ) {
    return this.artifactsWriter.write(outputDir, result, context);
  }

  private async blockAndThrow(
    outputDir: string,
    input: { prNumber?: number; blockReason: string },
  ): Promise<never> {
    const result = createBlockedCorrelationResult(input.blockReason);
    const paths = await this.persistArtifacts(outputDir, result, { prNumber: input.prNumber });
    throw new CorrelationBlockedError(result, paths.requiredScenariosPath, paths.correlationReportPath);
  }
}
