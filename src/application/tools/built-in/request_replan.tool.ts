import { PlanPatchSchema, type ExecutionPlan, type ExecutionStep, type ReplanReason } from '../../../domain/schemas/execution-plan.schema.js';
import { ScreenObservationSchema, type ScreenObservation } from '../../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  PlanReplanInputSchema,
  ToolResultSchema,
  type PlanReplanInput,
  type ToolResult,
} from './contracts.js';
import { configFrom, contextService, failed, ok } from './support.js';
import { executeProjectMemorySearch } from './memory-tool-support.js';

type ReplanServiceResult = {
  plan?: unknown;
  history?: {
    status?: unknown;
    patch?: unknown;
    basePlanId?: unknown;
    basePlanVersion?: unknown;
    appliedPlanVersion?: unknown;
    reason?: unknown;
    replanReason?: unknown;
  };
};

export const PlanReplanTool: QaTool<PlanReplanInput, ToolResult> = {
  name: 'qa.plan.replan',
  description: 'Request and validate a PlanPatch for a failed ExecutionPlan step without applying it outside runtime policy.',
  inputSchema: PlanReplanInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const replanner = contextService<{ replan(input: unknown): Promise<ReplanServiceResult> }>(context, 'planReplanner');
    const replanInput = normalizeReplanInput(input, configFrom(input, context, 'qa.plan.replan'));
    const memoryContext = await executeProjectMemorySearch({
      query: [replanInput.message, replanInput.failedStep.description].filter(Boolean).join(' ').slice(0, 500),
      projectPath: '.',
      limit: 5,
    }, context);

    try {
      const result = await replanner.replan({ ...replanInput, memoryContext });
      const patch = result.history?.patch ? PlanPatchSchema.parse(result.history.patch) : undefined;
      return ok({
        status: result.history?.status ?? 'APPLIED',
        patch,
        appliedPlan: result.plan,
        history: result.history,
        memoryContext,
      });
    } catch (error) {
      return failed({
        path: 'planPatch',
        code: errorCode(error),
        message: errorMessage(error),
      });
    }
  },
};

function normalizeReplanInput(input: PlanReplanInput, config: RunConfig): {
  config: RunConfig;
  plan: ExecutionPlan;
  failedStep: ExecutionStep;
  observation: ScreenObservation;
  reason: ReplanReason;
  message: string;
  history: Array<{ stepId: string; reason: ReplanReason; message: string }>;
  runData: Record<string, string>;
} {
  const plan = input.plan ?? input.currentPlan;
  const observation = input.observation ?? input.currentObservation;
  const reason = input.reason ?? input.replanReason;
  if (!plan) throw new Error('qa.plan.replan requires plan or currentPlan');
  if (!observation) throw new Error('qa.plan.replan requires observation or currentObservation');
  if (!reason) throw new Error('qa.plan.replan requires reason or replanReason');

  return {
    config,
    plan,
    failedStep: input.failedStep,
    observation: ScreenObservationSchema.parse(observation),
    reason,
    message: input.message ?? messageFrom(input),
    history: normalizeHistory(input.patchHistory ?? input.history),
    runData: input.runData,
  };
}

function normalizeHistory(history: Array<{ stepId: string; reason: string; message: string }>): Array<{ stepId: string; reason: ReplanReason; message: string }> {
  return history.map((item) => ({
    stepId: item.stepId,
    reason: item.reason as ReplanReason,
    message: item.message,
  }));
}

function messageFrom(input: PlanReplanInput): string {
  const failedCondition = input.failedCondition ? ` Failed condition: ${JSON.stringify(input.failedCondition)}.` : '';
  return `Replan requested for ${input.replanReason ?? input.reason}.${failedCondition}`;
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'REPLAN_BLOCKED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
