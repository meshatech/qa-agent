import { Injectable } from '@nestjs/common';
import type { ExecutionPlan, ExecutionStep } from '../../domain/schemas/execution-plan.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { STEP_MATCHERS } from './execution-plan/step-matchers.js';

@Injectable()
export class ExecutionPlanFactoryService {
  fromScenarios(config: RunConfig, scenarios: QaScenario[]): ExecutionPlan | undefined {
    const steps = scenarios.flatMap((scenario) =>
      scenario.tasks.flatMap((task) => this.stepsForTask(scenario.id, task, config)),
    );
    if (!steps.length) return undefined;
    return {
      schemaVersion: 'execution-plan.v1',
      planId: `plan_${config.demand.id}`,
      version: 1,
      goal: config.demand.title,
      mode: config.runtime.mode,
      runtime: {
        maxAttemptsPerStep: config.runtime.maxAttemptsPerStep,
        maxReplansPerScenario: config.runtime.maxReplansPerScenario,
        destructiveActionPolicy: config.runtime.destructiveActionPolicy,
      },
      steps,
      assertions: [],
    };
  }

  private stepsForTask(scenarioId: string, task: QaTask, config: RunConfig): ExecutionStep[] {
    for (const matcher of STEP_MATCHERS) {
      if (matcher.canHandle(task)) {
        return matcher.createSteps(scenarioId, task, config);
      }
    }
    return [];
  }
}
