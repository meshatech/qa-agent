import { Inject, Injectable } from '@nestjs/common';

import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ExecutionPlanSchema, type ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import { ExecutionPlanBuildError } from '../../domain/errors.js';
import { ExecutionPlanFactoryService } from './execution-plan-factory.service.js';

@Injectable()
export class ExecutionPlanBuilder {
  constructor(
    @Inject(ExecutionPlanFactoryService) private readonly factory: ExecutionPlanFactoryService,
  ) {}

  async build(input: {
    scenarios: QaScenario[];
    config: RunConfig;
  }): Promise<ExecutionPlan> {
    const { scenarios, config } = input;

    if (!scenarios || scenarios.length === 0) {
      throw new ExecutionPlanBuildError('Cannot build ExecutionPlan: no scenarios provided');
    }

    const normalized = scenarios.map((scenario) => this.ensureTasks(scenario));

    const plan = await this.factory.fromScenarios(config, normalized);

    if (!plan) {
      throw new ExecutionPlanBuildError('ExecutionPlanFactory returned undefined; no steps could be generated');
    }

    try {
      return ExecutionPlanSchema.parse(plan);
    } catch {
      throw new ExecutionPlanBuildError('Generated ExecutionPlan failed schema validation');
    }
  }

  private ensureTasks(scenario: QaScenario): QaScenario {
    if (scenario.tasks && scenario.tasks.length > 0) return scenario;
    return {
      ...scenario,
      tasks: [
        {
          id: `${scenario.id}-task`,
          title: scenario.title,
          expected: 'Scenario can be executed and validated safely.',
          status: 'PENDING',
        },
      ],
    };
  }
}
