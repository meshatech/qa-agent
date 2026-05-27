import { Injectable } from '@nestjs/common';

import { overlapScore, pathTokens, tokenize, truncate } from '../../domain/helpers/correlation-lexical.js';
import type {
  CorrelationItem,
  CorrelationResult,
  RequiredScenario,
  RiskItem,
} from '../../domain/schemas/correlation.schema.js';
import { createBlockedCorrelationResult } from '../../domain/schemas/correlation.schema.js';
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

    if (!input.demand.acceptanceCriteria.length) {
      return createBlockedCorrelationResult(
        'acceptanceCriteria is empty; cannot derive required scenarios',
        warnings,
      );
    }

    const hasChangedFiles = input.prDiff.changedFiles.length > 0;
    const hasAffectedSignals =
      input.prDiff.affectedRoutes.length > 0 || input.prDiff.affectedSchemas.length > 0;
    if (!hasChangedFiles && !hasAffectedSignals) {
      return createBlockedCorrelationResult(
        'changedFiles is empty and no affectedRoutes/affectedSchemas; insufficient PR diff signal',
        warnings,
      );
    }

    const risks = this.collectRegressionRisks(input.prDiff);
    const correlations: CorrelationItem[] = [];
    const scenarios: RequiredScenario[] = [];

    for (const criterion of input.demand.acceptanceCriteria) {
      const match = this.findBestCriterionMatch(criterion, input.prDiff, input.memoryResults);
      correlations.push(match.correlation);

      if (match.correlation.score < MIN_OVERLAP_SCORE) {
        risks.push({
          severity: 'HIGH',
          description: `Acceptance criterion has no related changed file or route: "${truncate(criterion, 120)}"`,
          type: 'uncovered_criterion',
        });
        continue;
      }

      scenarios.push({
        id: `required-scenario-${scenarios.length + 1}`,
        title: truncate(criterion, 100),
        intent: 'POSITIVE',
        rationale: match.correlation.rationale,
        relatedFiles: match.relatedFiles,
        riskScore: this.computeScenarioRiskScore(match.correlation.score, match.relatedFiles, risks),
      });

      if (scenarios.length >= MAX_SCENARIOS) {
        warnings.push(`Scenario cap reached (${MAX_SCENARIOS}); remaining criteria omitted`);
        break;
      }
    }

    if (!scenarios.length) {
      const routeScenarios = this.buildRouteFallbackScenarios(input.prDiff, input.memoryResults);
      scenarios.push(...routeScenarios.slice(0, MAX_SCENARIOS));
    }

    if (!scenarios.length) {
      return createBlockedCorrelationResult(
        'No required scenarios could be derived from acceptance criteria and PR diff',
        warnings,
      );
    }

    if (!input.memoryResults.length) {
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

  private collectRegressionRisks(prDiff: PrDiffContext): RiskItem[] {
    const risks: RiskItem[] = [];
    for (const file of prDiff.changedFiles) {
      if (!file.negativeLines.length) {
        continue;
      }
      risks.push({
        severity: file.negativeLines.length > 5 ? 'HIGH' : 'MEDIUM',
        description: `${file.negativeLines.length} removed line(s) in ${file.path} may indicate regression risk`,
        relatedFile: file.path,
        type: 'regression',
      });
    }
    return risks;
  }

  private findBestCriterionMatch(
    criterion: string,
    prDiff: PrDiffContext,
    memoryResults: MemorySearchResult[],
  ): { correlation: CorrelationItem; relatedFiles: string[] } {
    const criterionTokens = tokenize(criterion);
    let bestScore = 0;
    let bestFile: string | undefined;
    let bestRationale = 'No lexical overlap with changed files or affected routes';

    for (const file of prDiff.changedFiles) {
      const score = overlapScore(criterionTokens, pathTokens(file.path));
      if (score > bestScore) {
        bestScore = score;
        bestFile = file.path;
        bestRationale = `Criterion tokens overlap with changed file path ${file.path}`;
      }
    }

    for (const route of prDiff.affectedRoutes) {
      const score = overlapScore(criterionTokens, tokenize(route));
      if (score > bestScore) {
        bestScore = score;
        bestFile = undefined;
        bestRationale = `Criterion tokens overlap with affected route ${route}`;
      }
    }

    for (const schema of prDiff.affectedSchemas) {
      const score = overlapScore(criterionTokens, pathTokens(schema));
      if (score > bestScore) {
        bestScore = score;
        bestFile = schema;
        bestRationale = `Criterion tokens overlap with affected schema ${schema}`;
      }
    }

    let memoryChunk: string | undefined;
    const memoryBoost = this.memoryBoost(criterionTokens, prDiff, memoryResults);
    if (memoryBoost) {
      bestScore = Math.min(1, bestScore + memoryBoost.boost);
      memoryChunk = memoryBoost.chunkId;
      bestRationale = `${bestRationale}; ${memoryBoost.rationale}`;
    }

    const relatedFiles = bestFile ? [bestFile] : [];
    return {
      correlation: {
        criterion,
        file: bestFile,
        memoryChunk,
        score: bestScore,
        rationale: bestRationale,
      },
      relatedFiles,
    };
  }

  private memoryBoost(
    criterionTokens: Set<string>,
    prDiff: PrDiffContext,
    memoryResults: MemorySearchResult[],
  ): { boost: number; chunkId: string; rationale: string } | undefined {
    const relevantTypes = new Set(['route', 'flow', 'scenario']);
    for (const result of memoryResults) {
      const chunk = result.chunk;
      if (!relevantTypes.has(chunk.type)) {
        continue;
      }

      const routeHit = prDiff.affectedRoutes.some(
        (route) =>
          chunk.content.includes(route) ||
          chunk.title.includes(route) ||
          overlapScore(tokenize(route), tokenize(chunk.content)) > 0,
      );
      const criterionHit = overlapScore(criterionTokens, tokenize(`${chunk.title} ${chunk.content}`)) > 0;

      if (routeHit || criterionHit) {
        return {
          boost: Math.min(0.35, result.relevanceScore * 0.1 + 0.1),
          chunkId: chunk.id,
          rationale: `BM25 memory chunk ${chunk.id} (${chunk.type}) aligns with affected routes or criterion`,
        };
      }
    }
    return undefined;
  }

  private buildRouteFallbackScenarios(
    prDiff: PrDiffContext,
    memoryResults: MemorySearchResult[],
  ): RequiredScenario[] {
    const scenarios: RequiredScenario[] = [];
    for (const route of prDiff.affectedRoutes) {
      const relatedFiles = prDiff.changedFiles
        .filter((file) => file.kind === 'route' || pathTokens(file.path).has(route.replace(/^\//, '')))
        .map((file) => file.path);
      const memoryChunk = memoryResults.find(
        (item) => item.chunk.type === 'route' && item.chunk.content.includes(route),
      )?.chunk.id;

      scenarios.push({
        id: `required-scenario-route-${scenarios.length + 1}`,
        title: `Validate affected route ${route}`,
        intent: 'POSITIVE',
        rationale: memoryChunk
          ? `Affected route ${route} requires validation; memory chunk ${memoryChunk} provides context`
          : `Affected route ${route} changed in PR diff`,
        relatedFiles: relatedFiles,
        riskScore: relatedFiles.length ? 0.6 : 0.8,
      });
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
