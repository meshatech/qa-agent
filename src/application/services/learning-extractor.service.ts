import { Injectable } from '@nestjs/common';
import type { MemoryCandidate } from '../../domain/schemas/memory-candidate.schema.js';
import type { QaRunResult, QaStep } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

@Injectable()
export class LearningExtractorService {
  extract(result: QaRunResult, _config: RunConfig): MemoryCandidate[] {
    const runId = this.runIdFromResult(result);
    const timestamp = result.finishedAt ?? new Date().toISOString();

    const successfulLocators = this.extractSuccessfulLocators(result.steps, runId, timestamp);
    const failedLocators = this.extractFailedLocators(result.steps, runId, timestamp);
    const scenarioResults = this.extractScenarioResults(result.scenarios ?? [], runId, timestamp);

    return [...successfulLocators, ...failedLocators, ...scenarioResults];
  }

  extractSuccessfulLocators(steps: QaStep[], runId: string, timestamp: string): MemoryCandidate[] {
    return steps
      .map((step) => this.buildSuccessfulLocatorCandidate(step, runId, timestamp))
      .filter((candidate): candidate is MemoryCandidate => candidate !== undefined);
  }

  extractFailedLocators(steps: QaStep[], runId: string, timestamp: string): MemoryCandidate[] {
    return steps
      .map((step) => this.buildFailedLocatorCandidate(step, runId, timestamp))
      .filter((candidate): candidate is MemoryCandidate => candidate !== undefined);
  }

  extractScenarioResults(scenarios: NonNullable<QaRunResult['scenarios']>, runId: string, timestamp: string): MemoryCandidate[] {
    return scenarios
      .map((scenario) => this.buildScenarioCandidate(scenario, runId, timestamp))
      .filter((candidate): candidate is MemoryCandidate => candidate !== undefined);
  }

  private buildSuccessfulLocatorCandidate(step: QaStep, runId: string, timestamp: string): MemoryCandidate | undefined {
    const action = step.resolvedAction;
    if (action.type !== 'click' || !action.targetElementId) return undefined;

    const succeeded = step.error === undefined && step.validation?.ok === true;
    if (!succeeded) return undefined;

    const content = JSON.stringify({
      actionType: action.type,
      targetElementId: action.targetElementId,
      observationId: step.observationId,
      stepSummary: step.thoughtSummary,
      validation: step.validation,
    });

    return {
      id: this.candidateId('locator', step.stepId, runId),
      type: 'locator',
      title: `Resolved locator: ${step.thoughtSummary ?? action.targetElementId}`,
      content,
      sourceRunId: runId,
      sourceScenarioId: step.scenarioId,
      sourceTaskId: step.taskId,
      sourceStepId: step.stepId,
      confidence: 0.9,
      isConfirmed: false,
      status: 'pending_review',
      createdAt: timestamp,
      metadata: { elementId: action.targetElementId, result: 'success' },
    };
  }

  private buildFailedLocatorCandidate(step: QaStep, runId: string, timestamp: string): MemoryCandidate | undefined {
    const action = step.resolvedAction;
    if (action.type !== 'click' || !action.targetElementId) return undefined;

    const succeeded = step.error === undefined && step.validation?.ok === true;
    if (succeeded) return undefined;

    const content = JSON.stringify({
      actionType: action.type,
      targetElementId: action.targetElementId,
      observationId: step.observationId,
      stepSummary: step.thoughtSummary,
      validation: step.validation,
      error: step.error,
    });

    return {
      id: this.candidateId('locator', step.stepId, runId),
      type: 'known_issue',
      title: `Failed locator: ${step.thoughtSummary ?? action.targetElementId}`,
      content,
      sourceRunId: runId,
      sourceScenarioId: step.scenarioId,
      sourceTaskId: step.taskId,
      sourceStepId: step.stepId,
      confidence: 0.5,
      isConfirmed: false,
      status: 'pending_review',
      createdAt: timestamp,
      metadata: { elementId: action.targetElementId, result: 'failure' },
    };
  }

  private buildScenarioCandidate(scenario: NonNullable<QaRunResult['scenarios']>[number], runId: string, timestamp: string): MemoryCandidate | undefined {
    const status = scenario.status;
    if (status !== 'PASSED' && status !== 'FAILED' && status !== 'BLOCKED') return undefined;

    const type = status === 'PASSED' ? 'scenario_result' : 'known_issue';
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
      title: `Scenario ${status.toLowerCase()}: ${scenario.title}`,
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
