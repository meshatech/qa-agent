import { Logger } from '@nestjs/common';
import type { ToolQueue, ToolQueueItem } from '../../domain/schemas/tool-queue.schema.js';
import type { ExecutionPlan, ExecutionStep, PlanAction, PlanCondition } from '../../domain/schemas/execution-plan.schema.js';

export interface MapperInput {
  queue: ToolQueue;
  goal: string;
  planId: string;
  scenarioId?: string;
  taskId?: string;
}

export class ToolQueueToExecutionPlanMapper {
  private readonly logger = new Logger(ToolQueueToExecutionPlanMapper.name);

  map(input: MapperInput): ExecutionPlan {
    const steps: ExecutionStep[] = input.queue.taskQueue.map((item, index) =>
      this.mapItem(item, index, input.scenarioId, input.taskId)
    );

    const hasFallback = input.queue.taskQueue.some((item) => item.fallback !== undefined);

    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: input.planId,
      version: 1,
      goal: input.goal,
      mode: 'HYBRID_GUARDED',
      runtime: {
        maxAttemptsPerStep: 2,
        maxReplansPerScenario: 2,
        destructiveActionPolicy: 'BLOCK',
      },
      steps,
      assertions: [],
      metadata: {
        planSource: 'orchestrator',
        fallbackReason: hasFallback ? 'ToolQueue contained fallback steps' : undefined,
        fallbackWarning: hasFallback ? 'Some steps have fallback tools defined' : undefined,
      },
    };

    this.logger.debug(`Mapped ${steps.length} steps from ToolQueue to ExecutionPlan ${input.planId}`);
    return plan;
  }

  private mapItem(item: ToolQueueItem, index: number, scenarioId?: string, taskId?: string): ExecutionStep {
    const base = {
      id: `step-${String(index + 1).padStart(3, '0')}`,
      scenarioId,
      taskId,
      description: `${item.tool}: ${JSON.stringify(item.params)}`,
      preconditions: [] as PlanCondition[],
      postconditions: [] as PlanCondition[],
      assertions: [] as PlanCondition[],
      onFailure: 'RECOVER' as const,
      action: this.mapAction(item),
    };

    switch (item.tool) {
      case 'navigator.open': {
        return {
          ...base,
          action: { type: 'navigate', to: item.params.url, reason: `Navigate to ${item.params.url}` },
          postconditions: [
            { type: 'route_state', expected: 'matches', expectedUrlPattern: item.params.url },
          ],
        };
      }
      case 'observer.capture': {
        return {
          ...base,
          action: { type: 'waitForStable', timeoutMs: 1000, reason: 'Capture page state' },
          postconditions: [{ type: 'no_console_errors' }],
        };
      }
      case 'actor.click': {
        return {
          ...base,
          action: { type: 'click', target: item.params.target, reason: 'Click target element' },
          postconditions: [
            { type: 'element_visible', target: item.params.target },
          ],
        };
      }
      case 'actor.fill': {
        return {
          ...base,
          action: { type: 'fill', target: item.params.target, value: item.params.value, reason: `Fill field with "${item.params.value}"` },
          postconditions: [
            { type: 'field_value_contains', target: item.params.target, value: item.params.value },
          ],
        };
      }
      case 'actor.type': {
        return {
          ...base,
          action: { type: 'typeText', text: item.params.text, delayMs: item.params.delayMs, reason: `Type text: ${item.params.text}` },
          postconditions: [{ type: 'text_visible', text: item.params.text }],
        };
      }
      case 'actor.press': {
        return {
          ...base,
          action: { type: 'press', key: item.params.key, reason: `Press key: ${item.params.key}` },
          postconditions: [{ type: 'no_console_errors' }],
        };
      }
      case 'validator.state': {
        return {
          ...base,
          action: { type: 'waitForStable', timeoutMs: 1000, reason: 'Validate state' },
          postconditions: [item.params.condition as PlanCondition],
        };
      }
      case 'explorer.scan': {
        const scanText = item.params.mode === 'scan_inputs' ? 'input' : item.params.mode === 'scan_clickables' ? 'button' : 'page';
        return {
          ...base,
          action: { type: 'assertVisible', text: scanText, reason: `Explore page for ${item.params.mode}` },
          postconditions: [{ type: 'no_console_errors' }],
        };
      }
      default: {
        // Exhaustive check — should never reach here after schema validation
        const _exhaustive: never = item;
        void _exhaustive;
        throw new Error(`Unknown tool: ${(item as ToolQueueItem).tool}`);
      }
    }
  }

  private mapAction(_item: ToolQueueItem): PlanAction {
    // Placeholder — the actual action is set per-tool in mapItem
    return { type: 'waitForStable', timeoutMs: 1000, reason: 'placeholder' };
  }
}
