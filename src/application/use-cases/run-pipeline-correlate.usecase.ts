import { Inject, Injectable } from '@nestjs/common';

import type { PipelineCorrelateRunResult } from '../dto/pipeline-correlate-result.dto.js';
import { buildMemorySearchQuery } from '../helpers/build-memory-search-query.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import type { CorrelationArtifactsWriterPort } from '../ports/correlation-artifacts-writer.port.js';
import { DemandContextPersistenceService } from '../services/demand-context-persistence.service.js';
import { DemandDiffMemoryCorrelatorService } from '../services/demand-diff-memory-correlator.service.js';
import { MemorySearchService } from '../services/memory-search.service.js';
import { ClickUpReaderError, CorrelationBlockedError } from '../../domain/errors.js';
import {
  createBlockedCorrelationResult,
  type CorrelationResult,
} from '../../domain/schemas/correlation.schema.js';
import { PrDiffContextSchema } from '../../domain/schemas/pr-diff-context.schema.js';
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
    const prDiff = await readPipelineArtifact(outputDir, 'pr-diff-context.json', PrDiffContextSchema);
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
      const message =
        error instanceof ClickUpReaderError
          ? `Failed to fetch demand from ClickUp: ${error.message}`
          : `Failed to persist demand context: ${error instanceof Error ? error.message : String(error)}`;
      return this.blockAndThrow(outputDir, {
        prNumber: prDiff.pullRequest.prNumber,
        blockReason: message,
      });
    }

    const memoryQuery = buildMemorySearchQuery(demand, prDiff);
    const memoryResponse = await this.memorySearch.search({
      query: memoryQuery,
      limit: 10,
      projectPath: options?.projectPath ?? process.cwd(),
      types: ['route', 'flow', 'scenario', 'semantic_locator'],
    });

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
    input: { prNumber: number; blockReason: string },
  ): Promise<never> {
    const result = createBlockedCorrelationResult(input.blockReason);
    const paths = await this.persistArtifacts(outputDir, result, { prNumber: input.prNumber });
    throw new CorrelationBlockedError(result, paths.requiredScenariosPath, paths.correlationReportPath);
  }
}
