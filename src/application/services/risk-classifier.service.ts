import { Injectable } from '@nestjs/common';
import type { RiskScore, RiskLevel, RiskFactor } from '../../domain/models/risk-score.model.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { RunHistoryEntry } from './run-history.service.js';

const RISK_WEIGHTS = {
  routeChange: 0.25,
  schemaChange: 0.20,
  testRemoval: 0.20,
  infraChange: 0.15,
  negativeDiff: 0.10,
  failureHistory: 0.10,
} as const;

@Injectable()
export class RiskClassifierService {
  classify(prContext: PrDiffContext, runHistory: RunHistoryEntry[]): RiskScore {
    const factors: RiskFactor[] = [];
    const timestamp = new Date().toISOString();

    factors.push(this.calculateRouteChangeFactor(prContext));
    factors.push(this.calculateSchemaChangeFactor(prContext));
    factors.push(this.calculateTestRemovalFactor(prContext));
    factors.push(this.calculateInfraChangeFactor(prContext));
    factors.push(this.calculateNegativeDiffFactor(prContext));
    factors.push(this.calculateFailureHistoryFactor(runHistory));

    const value = Math.min(
      factors.reduce((sum, f) => sum + f.contribution, 0),
      1.0,
    );
    const level = this.levelFromValue(value);

    return { value, level, factors, calculatedAt: timestamp };
  }

  private calculateRouteChangeFactor(prContext: PrDiffContext): RiskFactor {
    const routeFiles = prContext.changedFiles.filter((f) => f.kind === 'route');
    const contribution = routeFiles.length > 0
      ? Math.min(routeFiles.length * 0.1, RISK_WEIGHTS.routeChange)
      : 0;
    return { name: 'route_change', weight: RISK_WEIGHTS.routeChange, contribution };
  }

  private calculateSchemaChangeFactor(prContext: PrDiffContext): RiskFactor {
    const schemaFiles = prContext.changedFiles.filter((f) => f.kind === 'schema');
    const contribution = schemaFiles.length > 0
      ? Math.min(schemaFiles.length * 0.1, RISK_WEIGHTS.schemaChange)
      : 0;
    return { name: 'schema_change', weight: RISK_WEIGHTS.schemaChange, contribution };
  }

  private calculateTestRemovalFactor(prContext: PrDiffContext): RiskFactor {
    const testFiles = prContext.changedFiles.filter(
      (f) => f.kind === 'test' && f.negativeLines.length > f.positiveLines.length,
    );
    const contribution = testFiles.length > 0 ? RISK_WEIGHTS.testRemoval : 0;
    return { name: 'test_removal', weight: RISK_WEIGHTS.testRemoval, contribution };
  }

  private calculateInfraChangeFactor(prContext: PrDiffContext): RiskFactor {
    const infraFiles = prContext.changedFiles.filter((f) => f.kind === 'infra');
    const contribution = infraFiles.length > 0
      ? Math.min(infraFiles.length * 0.08, RISK_WEIGHTS.infraChange)
      : 0;
    return { name: 'infra_change', weight: RISK_WEIGHTS.infraChange, contribution };
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
    const ratio = totalLines > 0 ? totalNegative / totalLines : 0;
    const contribution = ratio > 0.3 ? RISK_WEIGHTS.negativeDiff : 0;
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

  private levelFromValue(value: number): RiskLevel {
    if (value >= 0.75) return 'critical';
    if (value >= 0.5) return 'high';
    if (value >= 0.25) return 'medium';
    return 'low';
  }
}
