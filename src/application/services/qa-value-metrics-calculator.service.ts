import { Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaValueMetrics } from '../../domain/schemas/qa-value-metrics.schema.js';

@Injectable()
export class QaValueMetricsCalculatorService {
  compute(result: QaRunResult, config: RunConfig): QaValueMetrics {
    const manualPerScenario = config.reporting?.manualMinutesPerScenario ?? 10;
    const scenariosExecuted = result.metrics?.totalScenarios ?? (result.scenarios?.length ?? 0);
    const estimatedManualMinutes = scenariosExecuted * manualPerScenario;
    const agentExecutionMinutes = result.metrics?.totalDurationMs
      ? Math.max(0, Math.round(result.metrics.totalDurationMs / 60000))
      : 0;
    const estimatedMinutesSaved = agentExecutionMinutes > 0
      ? Math.max(0, estimatedManualMinutes - agentExecutionMinutes)
      : 0;
    const acceptanceCriteriaTotal = config.demand?.acceptanceCriteria?.length ?? 0;
    const acceptanceCriteriaCovered = this.countCoveredCriteria(result);
    const bugsFound = result.metrics?.totalBugs ?? (result.bugs?.length ?? 0);
    const evidenceFilesGenerated = result.bugs?.length
      ? result.bugs.length * 4
      : 0;

    return {
      estimatedManualMinutes,
      agentExecutionMinutes,
      estimatedMinutesSaved,
      scenariosExecuted,
      acceptanceCriteriaCovered,
      acceptanceCriteriaTotal,
      bugsFound,
      evidenceFilesGenerated,
    };
  }

  private countCoveredCriteria(result: QaRunResult): number {
    const planRuntime = (result as QaRunResult & { planRuntime?: { coverageMap?: Array<{ criterion: string }> } }).planRuntime;
    if (planRuntime?.coverageMap) return planRuntime.coverageMap.length;
    const scenarios = result.scenarios ?? [];
    const covered = new Set<string>();
    for (const s of scenarios) {
      for (const t of s.tasks) {
        if (t.expected) covered.add(t.expected);
      }
    }
    return covered.size;
  }
}
