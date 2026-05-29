import { Injectable } from '@nestjs/common';
import type { RiskScore, RiskLevel, RiskFactor } from '../../domain/models/risk-score.model.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { ChangedFileStatus } from '../../domain/schemas/changed-file.schema.js';
import type { RunHistoryEntry } from './run-history.service.js';

const RISK_WEIGHTS = {
  routeChange: 0.25,
  schemaChange: 0.20,
  testRemoval: 0.20,
  infraChange: 0.15,
  docsChange: 0.03,
  otherChange: 0.02,
  negativeDiff: 0.10,
  failureHistory: 0.10,
} as const;

const STATUS_MULTIPLIER: Record<ChangedFileStatus, number> = {
  modified: 1.0,
  added: 1.2,
  removed: 1.5,
};

@Injectable()
export class RiskClassifierService {
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

    const value = Math.min(
      factors.reduce((sum, f) => sum + f.contribution, 0),
      1.0,
    );
    const level = this.levelFromValue(value);

    return { value, level, factors, calculatedAt: timestamp };
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
