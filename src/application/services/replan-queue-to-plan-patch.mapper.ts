import { Logger } from '@nestjs/common';
import type { ReplanQueue } from '../../domain/schemas/replan-queue.schema.js';
import type { PlanPatch, ExecutionPlan, ReplanReason } from '../../domain/schemas/execution-plan.schema.js';
import { ToolQueueToExecutionPlanMapper } from './tool-queue-to-execution-plan.mapper.js';

export interface ReplanToPatchInput {
  replan: ReplanQueue;
  originalPlan: ExecutionPlan;
  replanReason: ReplanReason;
  scenarioId?: string;
  taskId?: string;
}

export class ReplanQueueToPlanPatchMapper {
  private readonly logger = new Logger(ReplanQueueToPlanPatchMapper.name);
  private readonly stepMapper = new ToolQueueToExecutionPlanMapper();

  map(input: ReplanToPatchInput): PlanPatch {
    const { replan, originalPlan, replanReason, scenarioId, taskId } = input;

    if (replan.action === 'abort') {
      return {
        basePlanId: originalPlan.planId,
        basePlanVersion: originalPlan.version,
        operation: 'mark_blocked',
        reason: replan.reasoning,
        replanReason,
        steps: [],
      };
    }

    if (replan.action === 'replace_remaining_steps') {
      if (!replan.fromStep) {
        throw new Error('replace_remaining_steps requires fromStep');
      }

      // Find the step ID at the given position (1-based)
      const targetStep = originalPlan.steps[replan.fromStep - 1];
      if (!targetStep) {
        throw new Error(`Step ${replan.fromStep} not found in original plan`);
      }

      // Convert replan taskQueue to ExecutionSteps
      const replacementSteps = replan.taskQueue
        ? this.stepMapper.map({
            queue: { taskQueue: replan.taskQueue, reasoning: replan.reasoning },
            goal: originalPlan.goal,
            planId: `${originalPlan.planId}-replan`,
            scenarioId,
            taskId,
          }).steps
        : [];

      this.logger.debug(`Replacing from step ${replan.fromStep} (${targetStep.id}) with ${replacementSteps.length} new steps`);

      return {
        basePlanId: originalPlan.planId,
        basePlanVersion: originalPlan.version,
        operation: 'replace_remaining_steps',
        stepId: targetStep.id,
        reason: replan.reasoning,
        replanReason,
        steps: replacementSteps,
      };
    }

    throw new Error(`Unknown replan action: ${replan.action}`);
  }
}
