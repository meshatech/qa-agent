import { Inject, Injectable } from '@nestjs/common';

import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import { ExecutionPlanSchema, type ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';

@Injectable()
export class PersistExecutionPlanUseCase {
  constructor(
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
  ) {}

  async execute(input: {
    runDir: string;
    plan: ExecutionPlan;
  }): Promise<ExecutionPlan> {
    const { runDir, plan } = input;

    ExecutionPlanSchema.parse(plan);
    await this.repo.writeJson(runDir, 'execution-plan.json', plan);

    return plan;
  }
}
