import { Inject, Injectable } from '@nestjs/common';
import type { ProjectGraphPort } from '../ports/project-graph.port.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import type { PlanExecutionResult } from './plan-executor.service.js';
import type { ProjectGraphExperience } from '../../domain/schemas/project-graph.schema.js';

@Injectable()
export class ProjectGraphService {
  constructor(@Inject('ProjectGraphPort') private readonly graph: ProjectGraphPort) {}

  async enrichPlan(plan: ExecutionPlan, projectPath: string): Promise<ExecutionPlan> {
    const nodes = await this.graph.query(projectPath, 'outcome');
    if (!nodes.length) return plan;

    const enrichedSteps = plan.steps.map((step) => {
      const node = nodes.find((n) => n.data?.stepDescription === step.description);
      if (!node) return step;

      const expectedStates = node.data?.expectedStates as Array<Record<string, unknown>> | undefined;
      if (!expectedStates?.length) return step;

      return {
        ...step,
        preconditions: [...step.preconditions, ...(expectedStates as unknown as typeof step.preconditions)],
      };
    });

    return { ...plan, steps: enrichedSteps };
  }

  async recordRunResult(result: PlanExecutionResult, projectPath: string): Promise<void> {
    const successfulLocators = result.locatorTelemetry
      ?.filter((t) => t.type === 'deterministic_resolution' && Boolean(t.elementId))
      .map((t) => ({ elementId: t.elementId, strategy: t.locatorStrategy })) ?? [];

    if (!successfulLocators.length) return;

    const exp: ProjectGraphExperience = {
      outcomeKind: 'run',
      validatedLocators: successfulLocators,
      expectedStates: [],
      appUrlPattern: undefined,
      successCount: result.ok ? 1 : 0,
      failureCount: result.ok ? 0 : 1,
    };
    await this.graph.recordExperience(projectPath, exp);
  }

  async getHintsForOutcome(outcomeKind: string, projectPath: string): Promise<Array<Record<string, unknown>>> {
    const nodes = await this.graph.query(projectPath, 'outcome');
    const node = nodes.find((n) => n.id === `outcome:${outcomeKind}`);
    if (!node) return [];
    return [
      {
        aliases: node.data?.aliases,
        likelyComponents: node.data?.likelyComponents,
        validatedLocators: node.data?.validatedLocators,
        expectedStates: node.data?.expectedStates,
        confidence: node.hits + node.misses > 0 ? node.hits / (node.hits + node.misses) : 0,
      },
    ];
  }
}
