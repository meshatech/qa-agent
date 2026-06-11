import { Logger, Injectable } from '@nestjs/common';
import { ReplanQueueSchema } from '../../domain/schemas/replan-queue.schema.js';
import type { PlanPatch, ExecutionPlan, ExecutionStep, ReplanReason } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { ToolQueue } from '../../domain/schemas/tool-queue.schema.js';
import { ReplanQueueToPlanPatchMapper } from './replan-queue-to-plan-patch.mapper.js';
import { buildOrchestratorReplanUserMessage, ORCHESTRATOR_REPLAN_SYSTEM_PROMPT } from '../../infra/llm/orchestrator-replan-prompt.builder.js';

export interface OrchestratorReplanInput {
  taskTitle: string;
  taskExpected: string;
  originalPlan: ExecutionPlan;
  failedStep: ExecutionStep;
  observation: ScreenObservation;
  replanReason: ReplanReason;
  errorMessage: string;
  executedSteps: Array<{ stepId: string; tool: string; ok: boolean }>;
  originalQueue: ToolQueue;
}

export interface LlmCallFn {
  (systemPrompt: string, userMessage: string): Promise<string>;
}

@Injectable()
export class OrchestratorReplanService {
  private readonly logger = new Logger(OrchestratorReplanService.name);
  private readonly patchMapper = new ReplanQueueToPlanPatchMapper();
  private maxRetries = 1;

  constructor(
    private readonly llmCall: LlmCallFn,
  ) {}

  async replan(input: OrchestratorReplanInput): Promise<PlanPatch> {
    const promptInput = {
      taskTitle: input.taskTitle,
      taskExpected: input.taskExpected,
      lastObservation: input.observation,
      executedSteps: input.executedSteps,
      failedStep: input.failedStep,
      errorMessage: input.errorMessage,
      originalQueue: input.originalQueue,
    };

    const userMessage = buildOrchestratorReplanUserMessage(promptInput);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const raw = await this.llmCall(ORCHESTRATOR_REPLAN_SYSTEM_PROMPT, userMessage);
        const parsed = this.parseJson(raw);
        const replanQueue = ReplanQueueSchema.parse(parsed);

        this.logger.debug(`Replan action: ${replanQueue.action}, reasoning: ${replanQueue.reasoning.slice(0, 100)}`);

        return this.patchMapper.map({
          replan: replanQueue,
          originalPlan: input.originalPlan,
          replanReason: input.replanReason,
          scenarioId: input.failedStep.scenarioId,
          taskId: input.failedStep.taskId,
        });
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        this.logger.warn(`Replan attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    this.logger.error(`All replan attempts failed. Returning BLOCKED patch.`);

    return {
      basePlanId: input.originalPlan.planId,
      basePlanVersion: input.originalPlan.version,
      operation: 'mark_blocked',
      reason: `Replan failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
      replanReason: input.replanReason,
      steps: [],
    };
  }

  private parseJson(raw: string): unknown {
    // Try to extract JSON from markdown code blocks or raw text
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return JSON.parse(raw.trim());
  }
}
