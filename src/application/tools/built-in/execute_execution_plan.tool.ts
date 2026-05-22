import type { PlanExecutionResult } from '../../services/plan-executor.service.js';
import { ExecutionPlanSchema, type ExecutionPlan } from '../../../domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  PlanExecuteInputSchema,
  ToolResultSchema,
  type PlanExecuteInput,
  type ToolResult,
} from './contracts.js';
import { contextService, ok } from './support.js';

type PlanExecutorToolService = {
  execute(plan: ExecutionPlan, config: RunConfig): Promise<PlanExecutionResult>;
};

export const PlanExecuteTool: QaTool<PlanExecuteInput, ToolResult> = {
  name: 'qa.plan.execute',
  description: 'Execute a validated ExecutionPlan through PlanExecutorService.',
  inputSchema: PlanExecuteInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const executor = contextService<PlanExecutorToolService>(context, 'planExecutor');
    const plan = ExecutionPlanSchema.parse(input.plan);
    const config = input.runConfig ?? input.config ?? context.config;
    if (!config) throw new Error('qa.plan.execute requires input.runConfig, input.config, or context.config');

    const execution = await executor.execute(plan, config);

    return ok({
      executionResult: execution,
      scenarioFinalStatus: execution.ok ? 'PASSED' : 'FAILED',
      warnings: execution.warnings,
      bugs: execution.failedStep ? [execution.failedStep] : [],
      artifacts: artifactsFrom(input),
      executionLogPath: executionLogPathFrom(input),
    });
  },
};

function artifactsFrom(input: PlanExecuteInput): Record<string, unknown> {
  return {
    scenarioId: input.scenarioId,
    outputConfig: input.outputConfig,
    planRef: input.planRef,
  };
}

function executionLogPathFrom(input: PlanExecuteInput): string | undefined {
  return input.planRef?.runDir ? `${input.planRef.runDir}/execution-log.json` : undefined;
}
