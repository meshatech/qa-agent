import { Inject, Injectable } from '@nestjs/common';
import type { RiskScore, RiskLevel, RiskFactor } from '../../domain/models/risk-score.model.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { ChangedFileStatus } from '../../domain/schemas/changed-file.schema.js';
import type { RunHistoryEntry } from './run-history.service.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';

const RISK_WEIGHTS = {
  routeChange: 0.25,
  schemaChange: 0.20,
  testRemoval: 0.20,
  infraChange: 0.15,
  docsChange: 0.03,
  otherChange: 0.02,
  negativeDiff: 0.10,
  failureHistory: 0.10,
  affectedRouteFailure: 0.08,
} as const;

const STATUS_MULTIPLIER: Record<ChangedFileStatus, number> = {
  modified: 1.0,
  added: 1.2,
  removed: 1.5,
};

@Injectable()
export class RiskClassifierService {
  constructor(
    @Inject('RunRepositoryPort') private readonly repository: RunRepositoryPort,
  ) {}

  classify(prContext: PrDiffContext, runHistory: RunHistoryEntry[]): RiskScore {
    const factors: RiskFactor[] = [];
    const timestamp = new Date().toISOString();

    factors.push(this.calculateFileTypeFactor(prContext, 'route', RISK_WEIGHTS.routeChange));
    factors.push(this.calculateFileTypeFactor(prContext, 'schema', RISK_WEIGHTS.schemaChange));
    factors.push(this.calculateTestRemovalFactor(prContext));
    factors.push(this.calculateFileTypeFactor(prContext, 'infra', RISK_WEIGHTS.infraChange));
    factors.push(this.calculateFileTypeFactor(prContext, 'docs', RISK_WEIGHTS.docsChange));
    factors.push(this.calculateFileTypeFactor(prContext, 'other', RISK_WEIGHTS.otherChange));
    factors.push(this.calculateNegativeDiffFactor(prContext));
    factors.push(this.calculateFailureHistoryFactor(runHistory));
    factors.push(this.calculateAffectedRouteFailureFactor(prContext, runHistory));

    const value = Math.min(
      factors.reduce((sum, f) => sum + f.contribution, 0),
      1.0,
    );
    const level = this.levelFromValue(value);
    const score: RiskScore = { value, level, factors, calculatedAt: timestamp, explanation: '' };
    score.explanation = this.generateExplanation(score);
    return score;
  }

  async save(runDir: string, score: RiskScore): Promise<void> {
    await this.repository.writeJson(runDir, 'risk-score.json', score);
  }

  private generateExplanation(score: RiskScore): string {
    const activeFactors = score.factors.filter((f) => f.contribution > 0);
    const factorLines = activeFactors.length > 0
      ? activeFactors.map((f) => `  - ${f.name}: contribution ${f.contribution.toFixed(3)} (weight ${f.weight})`).join('\n')
      : '  - No risk factors detected.';
    return `Risk score: ${score.value.toFixed(2)} (${score.level.toUpperCase()})\n` +
      `Calculated at: ${score.calculatedAt}\n` +
      `Factors considered:\n${factorLines}`;
  }

  private calculateFileTypeFactor(
    prContext: PrDiffContext,
    kind: 'route' | 'schema' | 'infra' | 'docs' | 'other',
    maxWeight: number,
  ): RiskFactor {
    const files = prContext.changedFiles.filter((f) => f.kind === kind);
    const contribution = files.length > 0
      ? Math.min(
          files.reduce((sum, f) => sum + 0.08 * STATUS_MULTIPLIER[f.status], 0),
          maxWeight,
        )
      : 0;
    return { name: `${kind}_change`, weight: maxWeight, contribution };
  }

  private calculateTestRemovalFactor(prContext: PrDiffContext): RiskFactor {
    const testFiles = prContext.changedFiles.filter(
      (f) => f.kind === 'test' && f.negativeLines.length > f.positiveLines.length,
    );
    const contribution = testFiles.length > 0 ? RISK_WEIGHTS.testRemoval : 0;
    return { name: 'test_removal', weight: RISK_WEIGHTS.testRemoval, contribution };
  }

  private calculateNegativeDiffFactor(prContext: PrDiffContext): RiskFactor {
    const totalNegative = prContext.changedFiles.reduce(
      (sum, f) => sum + f.negativeLines.length,
      0,
    );
    const totalPositive = prContext.changedFiles.reduce(
      (sum, f) => sum + f.positiveLines.length,
      0,
    );
    const totalLines = totalNegative + totalPositive;
    if (totalLines === 0) {
      return { name: 'negative_diff_ratio', weight: RISK_WEIGHTS.negativeDiff, contribution: 0 };
    }
    const ratio = totalNegative / totalLines;
    const contribution = ratio > 0.2
      ? Math.min(ratio * RISK_WEIGHTS.negativeDiff * 2, RISK_WEIGHTS.negativeDiff)
      : 0;
    return { name: 'negative_diff_ratio', weight: RISK_WEIGHTS.negativeDiff, contribution };
  }

  private calculateFailureHistoryFactor(runHistory: RunHistoryEntry[]): RiskFactor {
    const recentRuns = runHistory.slice(-10);
    if (recentRuns.length === 0) {
      return { name: 'failure_history', weight: RISK_WEIGHTS.failureHistory, contribution: 0 };
    }
    const failedRuns = recentRuns.filter(
      (run) => run.status === 'failed' || run.status === 'FAILED',
    );
    const failureRate = failedRuns.length / recentRuns.length;
    const contribution = failureRate > 0.2
      ? Math.min(failureRate * RISK_WEIGHTS.failureHistory * 3, RISK_WEIGHTS.failureHistory)
      : 0;
    return { name: 'failure_history', weight: RISK_WEIGHTS.failureHistory, contribution };
  }

  private calculateAffectedRouteFailureFactor(
    prContext: PrDiffContext,
    runHistory: RunHistoryEntry[],
  ): RiskFactor {
    const recentRuns = runHistory.slice(-10);
    if (recentRuns.length === 0) {
      return { name: 'affected_route_failure', weight: RISK_WEIGHTS.affectedRouteFailure, contribution: 0 };
    }
    const failedRuns = recentRuns.filter(
      (run) => run.status === 'failed' || run.status === 'FAILED',
    );
    if (failedRuns.length === 0) {
      return { name: 'affected_route_failure', weight: RISK_WEIGHTS.affectedRouteFailure, contribution: 0 };
    }
    const affectedCount = prContext.affectedRoutes.length + prContext.affectedSchemas.length;
    if (affectedCount === 0) {
      return { name: 'affected_route_failure', weight: RISK_WEIGHTS.affectedRouteFailure, contribution: 0 };
    }
    const failureRate = failedRuns.length / recentRuns.length;
    const contribution = failureRate > 0.2
      ? Math.min(affectedCount * 0.03 * failureRate, RISK_WEIGHTS.affectedRouteFailure)
      : 0;
    return { name: 'affected_route_failure', weight: RISK_WEIGHTS.affectedRouteFailure, contribution };
  }

  private levelFromValue(value: number): RiskLevel {
    if (value >= 0.75) return 'critical';
    if (value >= 0.5) return 'high';
    if (value >= 0.25) return 'medium';
    return 'low';
  }
}

