import { Injectable } from '@nestjs/common';
import type { MemoryCandidate } from '../../domain/schemas/memory-candidate.schema.js';
import type { QaRunResult, QaStep } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

@Injectable()
export class LearningExtractorService {
  extract(result: QaRunResult, _config: RunConfig): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const runId = this.runIdFromResult(result);
    const timestamp = result.finishedAt ?? new Date().toISOString();

    for (const step of result.steps) {
      const candidate = this.extractLocatorCandidate(step, runId, timestamp);
      if (candidate) candidates.push(candidate);
    }

    for (const scenario of result.scenarios ?? []) {
      const candidate = this.extractScenarioCandidate(scenario, runId, timestamp);
      if (candidate) candidates.push(candidate);
    }

    return candidates;
  }

  private extractLocatorCandidate(step: QaStep, runId: string, timestamp: string): MemoryCandidate | undefined {
    const action = step.resolvedAction;
    if (action.type !== 'click' || !action.targetElementId) return undefined;

    const succeeded = step.error === undefined && step.validation?.ok === true;
    const type = succeeded ? 'locator' : 'known_issue';
    const title = succeeded
      ? `Locator succeeded: ${step.thoughtSummary ?? action.targetElementId}`
      : `Locator failed: ${step.thoughtSummary ?? action.targetElementId}`;
    const content = JSON.stringify({
      actionType: action.type,
      targetElementId: action.targetElementId,
      observationId: step.observationId,
      succeeded,
      validation: step.validation,
      error: step.error,
    });

    return {
      id: this.candidateId('locator', step.stepId, runId),
      type,
      title,
      content,
      sourceRunId: runId,
      sourceScenarioId: step.scenarioId,
      sourceTaskId: step.taskId,
      sourceStepId: step.stepId,
      confidence: succeeded ? 0.9 : 0.5,
      isConfirmed: false,
      status: 'pending_review',
      createdAt: timestamp,
      metadata: { stepResult: succeeded ? 'passed' : 'failed' },
    };
  }

  private extractScenarioCandidate(scenario: NonNullable<QaRunResult['scenarios']>[number], runId: string, timestamp: string): MemoryCandidate | undefined {
    const status = scenario.status;
    if (status !== 'PASSED' && status !== 'FAILED' && status !== 'BLOCKED') return undefined;

    const type = status === 'PASSED' ? 'scenario_result' : 'known_issue';
    const title = `Scenario ${status.toLowerCase()}: ${scenario.title}`;
    const failedTasks = scenario.tasks.filter((task) => task.status === 'FAILED' || task.status === 'BLOCKED');
    const content = JSON.stringify({
      scenarioId: scenario.id,
      status,
      totalTasks: scenario.tasks.length,
      failedTasks: failedTasks.map((task) => ({ taskId: task.id, title: task.title, expected: task.expected })),
    });

    return {
      id: this.candidateId('scenario', scenario.id, runId),
      type,
      title,
      content,
      sourceRunId: runId,
      sourceScenarioId: scenario.id,
      confidence: status === 'PASSED' ? 1.0 : 0.6,
      isConfirmed: false,
      status: 'pending_review',
      createdAt: timestamp,
      metadata: { scenarioStatus: status },
    };
  }

  private runIdFromResult(result: QaRunResult): string {
    const fromDir = result.runDir?.split('/').pop();
    return fromDir ?? result.startedAt ?? 'unknown';
  }

  private candidateId(kind: string, sourceId: string, runId: string): string {
    return `${kind}_${sourceId}_${runId}`;
  }
}
