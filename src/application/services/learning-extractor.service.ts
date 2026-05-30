import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { MemoryCandidate } from '../../domain/schemas/memory-candidate.schema.js';
import type { QaRunResult, QaStep } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';

const LOCATOR_CONFIDENCE_HIGH = 0.9;
const LOCATOR_CONFIDENCE_MEDIUM = 0.5;
const SCENARIO_CONFIDENCE_PERFECT = 1.0;
const SCENARIO_CONFIDENCE_MEDIUM = 0.6;

@Injectable()
export class LearningExtractorService {
  constructor(
    @Inject('RunRepositoryPort') private readonly repository: RunRepositoryPort,
  ) {}

  extract(result: QaRunResult, _config: RunConfig): MemoryCandidate[] {
    const runId = this.runIdFromResult(result);
    const timestamp = result.finishedAt ?? new Date().toISOString();

    const successfulLocators = this.extractSuccessfulLocators(result.steps, runId, timestamp);
    const failedLocators = this.extractFailedLocators(result.steps, runId, timestamp);
    const scenarioResults = this.extractScenarioResults(result.scenarios ?? [], runId, timestamp);

    return [...successfulLocators, ...failedLocators, ...scenarioResults];
  }

  async persist(result: QaRunResult, candidates: MemoryCandidate[]): Promise<void> {
    const runId = this.runIdFromResult(result);
    const finalName = 'learning-candidates.json';
    const tempName = `${finalName}.${randomUUID()}.tmp`;
    try {
      await this.repository.writeJson(result.runDir, tempName, candidates);
      await this.repository.renameFile(result.runDir, tempName, finalName);
    } catch (error) {
      await this.repository.deleteFile(result.runDir, tempName).catch(() => {});
      throw error;
    }
    const entry = {
      runId,
      timestamp: result.finishedAt ?? new Date().toISOString(),
      status: result.status,
      totalSteps: result.steps.length,
      totalScenarios: result.scenarios?.length ?? 0,
      candidateCount: candidates.length,
      candidates: candidates.map((c) => ({ id: c.id, type: c.type, title: c.title, confidence: c.confidence })),
    };
    await this.repository.appendRunHistory(result.runDir, entry);
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
    return this.buildLocatorCandidate(step, runId, timestamp, 'success');
  }

  private buildFailedLocatorCandidate(step: QaStep, runId: string, timestamp: string): MemoryCandidate | undefined {
    return this.buildLocatorCandidate(step, runId, timestamp, 'failure');
  }

  private buildLocatorCandidate(
    step: QaStep,
    runId: string,
    timestamp: string,
    resultType: 'success' | 'failure',
  ): MemoryCandidate | undefined {
    const action = step.resolvedAction;
    const targetElementId = this.targetElementIdFromAction(action);
    if (!targetElementId) return undefined;

    const succeeded = step.error === undefined && step.validation?.ok !== false;
    if (resultType === 'success' && !succeeded) return undefined;
    if (resultType === 'failure' && succeeded) return undefined;

    const baseContent = {
      actionType: action.type,
      targetElementId,
      observationId: step.observationId,
      stepSummary: step.thoughtSummary,
      validation: step.validation,
      expected: step.boundExpected,
    };
    const content = resultType === 'failure'
      ? JSON.stringify({ ...baseContent, error: step.error })
      : JSON.stringify(baseContent);

    const titlePrefix = resultType === 'success' ? 'Resolved locator' : 'Failed locator';
    const type = resultType === 'success' ? 'locator' : 'known_issue';
    const confidence = resultType === 'success' ? LOCATOR_CONFIDENCE_HIGH : LOCATOR_CONFIDENCE_MEDIUM;

    return {
      id: this.candidateId('locator', step.stepId, runId),
      type,
      title: `${titlePrefix}: ${step.thoughtSummary ?? targetElementId}`,
      content,
      sourceRunId: runId,
      sourceScenarioId: step.scenarioId,
      sourceTaskId: step.taskId,
      sourceStepId: step.stepId,
      confidence,
      isConfirmed: false,
      status: 'pending_review',
      createdAt: timestamp,
      metadata: { elementId: targetElementId, actionType: action.type, result: resultType },
    };
  }

  private targetElementIdFromAction(action: QaAction): string | undefined {
    const maybeTargetedAction = action as { targetElementId?: unknown };
    return typeof maybeTargetedAction.targetElementId === 'string'
      ? maybeTargetedAction.targetElementId
      : undefined;
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
      confidence: status === 'PASSED' ? SCENARIO_CONFIDENCE_PERFECT : SCENARIO_CONFIDENCE_MEDIUM,
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
