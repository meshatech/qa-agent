import { ExecutionPlanSchema } from '../../../domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  PlanBuildInputSchema,
  ToolResultSchema,
  type PlanBuildInput,
  type ToolResult,
} from './contracts.js';
import { configFrom, contextService, ok } from './support.js';
import { fetchMemoryContextForConfig } from './memory-tool-support.js';

type PlanBuildResult = {
  plan?: unknown;
  source?: unknown;
  planSource?: unknown;
  fallbackReason?: unknown;
  fallbackWarning?: unknown;
};

export const PlanBuildTool: QaTool<PlanBuildInput, ToolResult> = {
  name: 'qa.plan.build',
  description: 'Build a validated ExecutionPlan from RunConfig and scenarios without executing browser actions.',
  inputSchema: PlanBuildInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const config = configFrom(input, context, 'qa.plan.build');
    const memoryContext = input.memoryContext ?? await fetchMemoryContextForConfig(config, context);
    const planner = contextService<{ build(config: RunConfig, scenarios: unknown[]): Promise<PlanBuildResult> }>(context, 'executionPlanPlanner');
    const result = await planner.build(config, input.scenarios);
    const plan = result.plan ? ExecutionPlanSchema.parse(result.plan) : undefined;
    const fallbackReason = typeof result.fallbackReason === 'string' ? result.fallbackReason : undefined;

    return ok({
      plan,
      planSource: result.planSource ?? result.source,
      fallbackReason,
      fallbackWarning: typeof result.fallbackWarning === 'string' ? result.fallbackWarning : fallbackWarning(fallbackReason),
      memoryContext,
    });
  },
};

function fallbackWarning(fallbackReason: string | undefined): string | undefined {
  if (!fallbackReason) return undefined;
  return fallbackReason.includes('semantically unsafe')
    ? 'LLM buildPlan was rejected by semantic policy; safe factory fallback was used.'
    : 'LLM buildPlan failed schema/provider validation; safe factory fallback was used.';
}
