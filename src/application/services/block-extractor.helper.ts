import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RuntimeErrorCode } from '../../domain/models/run.model.js';

export interface BlockItem {
  scenarioId?: string;
  scenarioTitle?: string;
  taskId?: string;
  taskTitle?: string;
  stepId?: string;
  code?: string;
  reason: string;
  source: 'scenario' | 'task' | 'step';
}

const BLOCK_ERROR_CODES = new Set<RuntimeErrorCode>([
  'TASK_DEPENDENCY_BLOCKED',
  'NAVIGATION_BLOCKED',
  'RECOVERY_EXHAUSTED',
  'CONCURRENT_ACTION_DENIED',
  'QUIESCENCE_TIMEOUT',
  'RUN_TIMEOUT',
]);

export function extractBlocksFromResult(result: QaRunResult): BlockItem[] {
  const blocks: BlockItem[] = [];
  const seen = new Set<string>();

  function key(item: BlockItem): string {
    return [
      item.source,
      item.scenarioId ?? '',
      item.taskId ?? '',
      item.stepId ?? '',
      item.code ?? '',
      item.reason,
    ].join('|');
  }

  for (const scenario of result.scenarios ?? []) {
    if (scenario.status === 'BLOCKED') {
      const item: BlockItem = {
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        reason: `Scenario blocked: ${scenario.title || 'Untitled scenario'}`,
        source: 'scenario',
      };
      const k = key(item);
      if (!seen.has(k)) {
        seen.add(k);
        blocks.push(item);
      }
    }
  }

  for (const scenario of result.scenarios ?? []) {
    for (const task of scenario.tasks ?? []) {
      if (task.status === 'BLOCKED') {
        const item: BlockItem = {
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          taskId: task.id,
          taskTitle: task.title,
          reason: `Task blocked: ${task.title || 'Untitled task'}`,
          source: 'task',
        };
        const k = key(item);
        if (!seen.has(k)) {
          seen.add(k);
          blocks.push(item);
        }
      }
    }
  }

  for (const step of result.steps ?? []) {
    if (step.error?.code && BLOCK_ERROR_CODES.has(step.error.code)) {
      const item: BlockItem = {
        scenarioId: step.scenarioId,
        taskId: step.taskId,
        stepId: step.stepId,
        code: step.error.code,
        reason: `${step.error.code}: ${step.error.message || 'No message'}`,
        source: 'step',
      };
      const k = key(item);
      if (!seen.has(k)) {
        seen.add(k);
        blocks.push(item);
      }
    }
  }

  return blocks;
}
