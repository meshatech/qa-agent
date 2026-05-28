import type { QaTask } from '../../../domain/models/run.model.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { ExecutionStep } from '../../../domain/schemas/execution-plan.schema.js';

/**
 * Strategy interface for matching a QaTask to a specific ExecutionStep template.
 * Each matcher decides whether it can handle a task and, if so, produces the steps.
 */
export interface StepMatcher {
  /**
   * Priority order; lower numbers are evaluated first.
   */
  readonly priority: number;
  /**
   * Returns true when this matcher knows how to handle the task.
   */
  canHandle(task: QaTask): boolean;
  /**
   * Builds the ExecutionStep(s) for the matched task.
   */
  createSteps(scenarioId: string, task: QaTask, config: RunConfig): ExecutionStep[];
}
