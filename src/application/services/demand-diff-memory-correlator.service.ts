import { Injectable } from '@nestjs/common';

import { correlateCriterionWithDiff } from '../../domain/helpers/criterion-diff-correlator.js';
import { correlateNegativeDiffRegressions } from '../../domain/helpers/negative-diff-regression-correlator.js';
import { consumeDemandContext } from '../../domain/helpers/demand-context-consumer.js';
import type { ConsumedMemorySearchContext } from '../../domain/helpers/memory-search-consumer.js';
import { consumeMemorySearchResults } from '../../domain/helpers/memory-search-consumer.js';
import type { ConsumedPrDiffContext } from '../../domain/helpers/pr-diff-context-consumer.js';
import { consumePrDiffContext } from '../../domain/helpers/pr-diff-context-consumer.js';
import { pathTokens, truncate } from '../../domain/helpers/correlation-lexical.js';
import type {
  CorrelationItem,
  CorrelationResult,
  RequiredScenario,
  RiskItem,
} from '../../domain/schemas/correlation.schema.js';
import { createBlockedCorrelationResult } from '../../domain/schemas/correlation.schema.js';
import { createRequiredScenario } from '../../domain/schemas/required-scenario.schema.js';
import { createRiskItem } from '../../domain/schemas/risk-item.schema.js';
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

    const demand = consumeDemandContext(input.demand);

    if (!demand.acceptanceCriteria.length) {
      return createBlockedCorrelationResult(
        'acceptanceCriteria is empty; cannot derive required scenarios',
        warnings,
      );
    }

    const prDiff = consumePrDiffContext(input.prDiff);

    if (!prDiff.hasDiffSignal) {
      return createBlockedCorrelationResult(
        'changedFiles is empty and no affectedRoutes/affectedSchemas; insufficient PR diff signal',
        warnings,
      );
    }

    const memory = consumeMemorySearchResults(input.memoryResults);

    const risks = correlateNegativeDiffRegressions({ prDiff, memory });
    const correlations: CorrelationItem[] = [];
    const scenarios: RequiredScenario[] = [];

    for (const criterion of demand.acceptanceCriteria) {
      const match = correlateCriterionWithDiff({ criterion, prDiff, memory });
      correlations.push(match.correlation);

      if (match.correlation.score < MIN_OVERLAP_SCORE) {
        risks.push(
          createRiskItem({
            severity: 'HIGH',
            description: `Acceptance criterion has no related changed file or route: "${truncate(criterion, 120)}"`,
            type: 'uncovered_criterion',
          }),
        );
        continue;
      }

      scenarios.push(
        createRequiredScenario({
          id: `required-scenario-${scenarios.length + 1}`,
          title: truncate(criterion, 100),
          intent: 'POSITIVE',
          rationale: match.correlation.rationale,
          relatedFiles: match.relatedFiles,
          riskScore: this.computeScenarioRiskScore(match.correlation.score, match.relatedFiles, risks),
        }),
      );

      if (scenarios.length >= MAX_SCENARIOS) {
        warnings.push(`Scenario cap reached (${MAX_SCENARIOS}); remaining criteria omitted`);
        break;
      }
    }

    if (!scenarios.length) {
      const routeScenarios = this.buildRouteFallbackScenarios(prDiff, memory);
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

  private computeScenarioRiskScore(
    correlationScore: number,
    relatedFiles: string[],
    risks: RiskItem[],
  ): number {
    const base = 1 - Math.min(1, correlationScore);
    const fileRisk = relatedFiles.some((file) =>
      risks.some((risk) => risk.relatedFile === file && risk.type === 'regression'),
    )
      ? 0.25
      : 0;
    return Math.min(1, Math.max(0, base + fileRisk));
  }
}
