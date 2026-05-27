import { Injectable } from '@nestjs/common';
import { ZodError } from 'zod';

import { correlateCriterionWithDiff } from '../../domain/helpers/criterion-diff-correlator.js';
import { detectDemandDiffMismatch } from '../../domain/helpers/demand-diff-mismatch-detector.js';
import { correlateNegativeDiffRegressions } from '../../domain/helpers/negative-diff-regression-correlator.js';
import { consumeDemandContext, type ConsumedDemandContext } from '../../domain/helpers/demand-context-consumer.js';
import type { ConsumedMemorySearchContext } from '../../domain/helpers/memory-search-consumer.js';
import { consumeMemorySearchResults } from '../../domain/helpers/memory-search-consumer.js';
import type { ConsumedPrDiffContext } from '../../domain/helpers/pr-diff-context-consumer.js';
import { consumePrDiffContext } from '../../domain/helpers/pr-diff-context-consumer.js';
import { computeScenarioRiskScore } from '../../domain/helpers/scenario-risk-scorer.js';
import { detectUncoveredCriteria } from '../../domain/helpers/uncovered-criterion-detector.js';
import { pathTokens, truncate } from '../../domain/helpers/correlation-lexical.js';
import type { CorrelationResult, RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import { createBlockedCorrelationResult } from '../../domain/schemas/correlation.schema.js';
import { createRequiredScenario } from '../../domain/schemas/required-scenario.schema.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';
import type { MemorySearchResult } from '../../domain/schemas/memory.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

const MAX_SCENARIOS = 10;
const MIN_OVERLAP_SCORE = 0.15;

export interface DemandDiffMemoryCorrelatorInput {
  demand: DemandContext;
  prDiff: PrDiffContext;
  memoryResults: MemorySearchResult[];
  warnings?: string[];
}

@Injectable()
export class DemandDiffMemoryCorrelatorService {
  correlate(input: DemandDiffMemoryCorrelatorInput): CorrelationResult {
    const warnings = [...(input.warnings ?? [])];

    let demand: ConsumedDemandContext;
    try {
      demand = consumeDemandContext(input.demand);
    } catch (error) {
      if (error instanceof ZodError) {
        return createBlockedCorrelationResult(
          `Invalid demand context schema: ${error.message}`,
          warnings,
        );
      }
      throw error;
    }

    if (!demand.acceptanceCriteria.length) {
      return createBlockedCorrelationResult(
        'acceptanceCriteria is empty; cannot derive required scenarios',
        warnings,
      );
    }

    let prDiff: ConsumedPrDiffContext;
    try {
      prDiff = consumePrDiffContext(input.prDiff);
    } catch (error) {
      if (error instanceof ZodError) {
        return createBlockedCorrelationResult(
          `Invalid PR diff context schema: ${error.message}`,
          warnings,
        );
      }
      throw error;
    }

    if (!prDiff.hasDiffSignal) {
      return createBlockedCorrelationResult(
        'changedFiles is empty and no affectedRoutes/affectedSchemas; insufficient PR diff signal',
        warnings,
      );
    }

    let memory: ConsumedMemorySearchContext;
    try {
      memory = consumeMemorySearchResults(input.memoryResults);
    } catch (error) {
      if (error instanceof ZodError) {
        return createBlockedCorrelationResult(
          `Invalid memory search results schema: ${error.message}`,
          warnings,
        );
      }
      throw error;
    }

    const risks = [
      ...correlateNegativeDiffRegressions({ prDiff, memory }),
      ...detectDemandDiffMismatch({ demand, prDiff }),
    ];
    const scenarios: RequiredScenario[] = [];

    const matches = demand.acceptanceCriteria.map((criterion) =>
      correlateCriterionWithDiff({ criterion, prDiff, memory }),
    );
    const correlations = matches.map((match) => match.correlation);

    risks.push(
      ...detectUncoveredCriteria({
        acceptanceCriteria: demand.acceptanceCriteria,
        correlations,
        minOverlapScore: MIN_OVERLAP_SCORE,
      }).risks,
    );

    for (const match of matches) {
      if (match.correlation.score < MIN_OVERLAP_SCORE) {
        continue;
      }

      scenarios.push(
        createRequiredScenario({
          id: `required-scenario-${scenarios.length + 1}`,
          title: truncate(match.correlation.criterion, 100),
          intent: 'POSITIVE',
          rationale: match.correlation.rationale,
          relatedFiles: match.relatedFiles,
          riskScore: computeScenarioRiskScore({
            correlation: match.correlation,
            relatedFiles: match.relatedFiles,
            risks,
          }),
        }),
      );

      if (scenarios.length >= MAX_SCENARIOS) {
        warnings.push(`Scenario cap reached (${MAX_SCENARIOS}); remaining criteria omitted`);
        break;
      }
    }

    if (!scenarios.length) {
      const routeScenarios = this.buildRouteFallbackScenarios(prDiff, memory);
      if (routeScenarios.length > 0) {
        warnings.push(
          'No acceptance criterion reached minimum correlation score; scenarios derived from affected routes only',
        );
      }
      scenarios.push(...routeScenarios.slice(0, MAX_SCENARIOS));
    }

    if (!scenarios.length) {
      return createBlockedCorrelationResult(
        'No required scenarios could be derived from acceptance criteria and PR diff',
        warnings,
      );
    }

    if (memory.isEmpty) {
      warnings.push('BM25 memory returned no chunks; correlation used PR diff and demand only');
    }

    return {
      schemaVersion: 'correlation-result.v1',
      status: 'OK',
      scenarios,
      correlations,
      risks,
      warnings,
    };
  }

  private buildRouteFallbackScenarios(
    prDiff: ConsumedPrDiffContext,
    memory: ConsumedMemorySearchContext,
  ): RequiredScenario[] {
    if (prDiff.changedFiles.length === 0) {
      return [];
    }

    const scenarios: RequiredScenario[] = [];
    for (const route of prDiff.affectedRoutes) {
      const relatedFiles = prDiff.changedFiles
        .filter((file) => file.kind === 'route' || pathTokens(file.path).has(route.replace(/^\//, '')))
        .map((file) => file.path);
      const memoryChunk = memory.correlationChunks.find(
        (item) => item.chunk.type === 'route' && item.chunk.content.includes(route),
      )?.chunk.id;

      scenarios.push(
        createRequiredScenario({
          id: `required-scenario-route-${scenarios.length + 1}`,
          title: `Validate affected route ${route}`,
          intent: 'POSITIVE',
          rationale: memoryChunk
            ? `Affected route ${route} requires validation; memory chunk ${memoryChunk} provides context`
            : `Affected route ${route} changed in PR diff`,
          relatedFiles: relatedFiles,
          riskScore: relatedFiles.length ? 0.6 : 0.8,
        }),
      );
    }
    return scenarios;
  }
}
