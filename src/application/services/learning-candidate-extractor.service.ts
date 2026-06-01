import { Injectable } from '@nestjs/common';
import type { LearningCandidate } from '../../domain/schemas/learning-candidate.schema.js';

export interface ExtractLearningCandidatesInput {
  runId: string;
  executionResult: {
    ok?: boolean;
    steps?: Array<{
      stepId: string;
      scenarioId?: string;
      taskId?: string;
      action?: Record<string, unknown>;
      resolvedAction?: Record<string, unknown>;
      boundExpected?: Record<string, unknown>;
      validation?: { ok?: boolean };
      error?: { message?: string };
    }>;
    attempts?: Array<{ actionType: string; result: string; reason?: string }>;
    warnings?: Array<{ stepId: string; message: string }>;
    locatorTelemetry?: Array<{
      stepId: string;
      type: string;
      locatorStrategy?: string;
      elementId?: string;
    }>;
    patchHistory?: Array<Record<string, unknown>>;
    evaluations?: Array<{
      conditionId: string;
      stepId: string;
      phase: string;
      type: string;
      passed: boolean;
      expected?: unknown;
      actual?: unknown;
      severity: string;
      reason: string;
    }>;
    failedMessage?: string;
  };
  executionPlan: {
    planId: string;
    goal: string;
    steps?: Array<{
      id: string;
      scenarioId?: string;
      taskId?: string;
      description: string;
      action: Record<string, unknown>;
      postconditions?: Array<Record<string, unknown>>;
      assertions?: Array<Record<string, unknown>>;
    }>;
    metadata?: {
      planSource?: string;
      fallbackReason?: string;
    };
  };
  selectedScenarios: {
    scenarios?: Array<{
      id: string;
      title: string;
      tasks?: Array<{
        id: string;
        title: string;
        expected: string;
        expectedOutcome?: { kind: string; description: string; target?: string };
      }>;
    }>;
  };
  memoryConsultationLog?: {
    entries?: Array<{
      query: string;
      chunks: Array<{ id: string; type: string; title: string; score?: number }>;
      used: boolean;
    }>;
  };
}

function isEphemeralId(id?: string): boolean {
  return Boolean(id && /^el_\d{3,}$/.test(id));
}

@Injectable()
export class LearningCandidateExtractorService {
  extract(input: ExtractLearningCandidatesInput): LearningCandidate[] {
    const candidates: LearningCandidate[] = [];
    const now = new Date().toISOString();
    const { runId, executionResult, executionPlan, selectedScenarios, memoryConsultationLog } = input;

    // 1. Extract from locator telemetry
    for (const event of executionResult.locatorTelemetry ?? []) {
      const isConfirmed = event.type === 'deterministic_resolution';
      const isSemanticFallback = event.type === 'semantic_fallback';
      const isTargetNotFound = event.type === 'target_not_found';

      if (isEphemeralId(event.elementId)) {
        // Skip: do not persist ephemeral IDs as stable locators
        continue;
      }

      if (isConfirmed || isSemanticFallback) {
        candidates.push({
          id: `lc-${runId}-${event.stepId}-locator`,
          type: 'semantic_locator',
          runId,
          scenarioId: this.findScenarioForStep(event.stepId, executionPlan),
          stepId: event.stepId,
          description: `Locator ${isConfirmed ? 'resolved deterministically' : 'via semantic fallback'}`,
          content: `Strategy: ${event.locatorStrategy ?? 'unknown'}; Element: ${event.elementId ?? 'unknown'}`,
          source: isConfirmed ? 'confirmed' : 'inferred',
          confidence: isConfirmed ? 0.9 : 0.6,
          risk: isConfirmed ? 'low' : 'medium',
          metadata: {
            locatorStrategy: event.locatorStrategy,
            elementId: event.elementId,
            hadTokenOverlap: false,
            hadReplan: false,
            hadDecide: false,
            ephemeralIdPresent: isEphemeralId(event.elementId),
          },
          generatedAt: now,
        });
      }

      if (isTargetNotFound) {
        candidates.push({
          id: `lc-${runId}-${event.stepId}-gap`,
          type: 'gap',
          runId,
          scenarioId: this.findScenarioForStep(event.stepId, executionPlan),
          stepId: event.stepId,
          description: 'Locator not found during execution',
          content: `Target could not be resolved for step ${event.stepId}. Memory may need a semantic_locator entry.`,
          source: 'inferred',
          confidence: 0.5,
          risk: 'high',
          metadata: {
            memoryGap: `missing_locator_for_${event.stepId}`,
            hadReplan: false,
            hadDecide: false,
          },
          generatedAt: now,
        });
      }
    }

    // 2. Extract from replan/decide events in telemetry
    for (const event of executionResult.locatorTelemetry ?? []) {
      if (event.type === 'replan') {
        candidates.push({
          id: `lc-${runId}-${event.stepId}-replan`,
          type: 'recovery_pattern',
          runId,
          scenarioId: this.findScenarioForStep(event.stepId, executionPlan),
          stepId: event.stepId,
          description: 'Plan replanned during execution',
          content: `Step ${event.stepId} required replanning. Consider updating the execution plan or memory.`,
          source: 'confirmed',
          confidence: 0.8,
          risk: 'medium',
          metadata: { hadReplan: true },
          generatedAt: now,
        });
      }
      if (event.type === 'llm_decide') {
        candidates.push({
          id: `lc-${runId}-${event.stepId}-decide`,
          type: 'component_behavior',
          runId,
          scenarioId: this.findScenarioForStep(event.stepId, executionPlan),
          stepId: event.stepId,
          description: 'LLM decision used as fallback',
          content: `Step ${event.stepId} used DecisionProviderPort.decide() as fallback. The target may need a semantic_locator entry.`,
          source: 'inferred',
          confidence: 0.6,
          risk: 'medium',
          metadata: { hadDecide: true },
          generatedAt: now,
        });
      }
    }

    // 3. Extract from patch history
    for (const patch of executionResult.patchHistory ?? []) {
      const stepId = String(patch.stepId ?? 'unknown');
      candidates.push({
        id: `lc-${runId}-${stepId}-patch`,
        type: 'recovery_pattern',
        runId,
        stepId,
        description: 'Plan patched during execution',
        content: `Patch applied: ${patch.reason ?? 'unknown'}. Consider updating the base execution plan.`,
        source: 'confirmed',
        confidence: 0.85,
        risk: 'medium',
        metadata: { hadReplan: true },
        generatedAt: now,
      });
    }

    // 4. Extract from evaluation failures
    for (const evalItem of executionResult.evaluations ?? []) {
      if (!evalItem.passed && evalItem.severity === 'ERROR') {
        candidates.push({
          id: `lc-${runId}-${evalItem.stepId}-eval`,
          type: 'component_behavior',
          runId,
          stepId: evalItem.stepId,
          description: `Condition failed: ${evalItem.phase} ${evalItem.type}`,
          content: `Step ${evalItem.stepId}: expected ${JSON.stringify(evalItem.expected)}, actual ${JSON.stringify(evalItem.actual)}. Reason: ${evalItem.reason}`,
          source: 'confirmed',
          confidence: 0.9,
          risk: 'high',
          metadata: {},
          generatedAt: now,
        });
      }
    }

    // 5. Extract from warnings
    for (const warning of executionResult.warnings ?? []) {
      candidates.push({
        id: `lc-${runId}-${warning.stepId}-warning`,
        type: 'component_behavior',
        runId,
        stepId: warning.stepId,
        description: `Warning during execution: ${warning.message.slice(0, 60)}`,
        content: warning.message,
        source: 'confirmed',
        confidence: 0.8,
        risk: 'medium',
        metadata: {},
        generatedAt: now,
      });
    }

    // 6. Extract from scenario → expected outcome mappings
    for (const scenario of selectedScenarios.scenarios ?? []) {
      for (const task of scenario.tasks ?? []) {
        if (task.expectedOutcome) {
          candidates.push({
            id: `lc-${runId}-${scenario.id}-${task.id}-outcome`,
            type: 'semantic_locator',
            runId,
            scenarioId: scenario.id,
            taskId: task.id,
            description: `Expected outcome mapping: ${task.expectedOutcome.description}`,
            content: `Kind: ${task.expectedOutcome.kind}; Target: ${task.expectedOutcome.target ?? 'N/A'}; Description: ${task.expectedOutcome.description}`,
            source: 'confirmed',
            confidence: 0.85,
            risk: 'low',
            metadata: {
              semanticKey: task.expectedOutcome.target,
            },
            generatedAt: now,
          });
        }
      }
    }

    // 7. Memory gaps: check if memory consultation returned nothing useful
    if (memoryConsultationLog?.entries) {
      for (const entry of memoryConsultationLog.entries) {
        if (!entry.used || entry.chunks.length === 0) {
          candidates.push({
            id: `lc-${runId}-memory-gap-${entry.query.slice(0, 30)}`,
            type: 'gap',
            runId,
            description: 'Memory query returned no useful results',
            content: `Query: "${entry.query}" produced no usable memory chunks. Consider adding a semantic_locator or route entry.`,
            source: 'inferred',
            confidence: 0.5,
            risk: 'medium',
            metadata: {
              memoryGap: `no_results_for_${entry.query.slice(0, 30)}`,
            },
            generatedAt: now,
          });
        }
      }
    }

    // 8. Extract from plan fallback reason
    if (executionPlan.metadata?.fallbackReason) {
      candidates.push({
        id: `lc-${runId}-plan-fallback`,
        type: 'recovery_pattern',
        runId,
        description: 'Execution plan used fallback',
        content: executionPlan.metadata.fallbackReason,
        source: 'confirmed',
        confidence: 0.9,
        risk: 'low',
        metadata: { hadReplan: true },
        generatedAt: now,
      });
    }

    return candidates;
  }

  private findScenarioForStep(stepId: string, executionPlan: ExtractLearningCandidatesInput['executionPlan']): string | undefined {
    return executionPlan.steps?.find((s) => s.id === stepId)?.scenarioId;
  }
}
