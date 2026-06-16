import { Inject, Injectable, Logger } from '@nestjs/common';
import { Command } from '@langchain/langgraph';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import type { PlanExecutionResult } from './plan-executor.service.js';
import { PlanStepRunnerService } from './plan-step-runner.service.js';
import type { DestructiveActionApproverPort } from '../ports/destructive-action-approver.port.js';
import { buildPlanExecutionGraph, stateToResult, type PlanExecutionGraphState } from '../../infra/graph/plan-execution.graph.js';

@Injectable()
export class PlanGraphExecutorService {
  constructor(
    @Inject(PlanStepRunnerService) private readonly runner: PlanStepRunnerService,
    @Inject('DestructiveActionApproverPort') private readonly approver: DestructiveActionApproverPort,
    private readonly logger: Logger = new Logger('PlanGraphExecutorService'),
  ) {}

  async execute(plan: ExecutionPlan, config: RunConfig, threadId?: string): Promise<PlanExecutionResult> {
    const graph = buildPlanExecutionGraph(this.runner, this.approver, this.logger);
    const thread = { configurable: { thread_id: threadId ?? `run-${Date.now()}` }, recursionLimit: 100 };

    let state = await graph.invoke(
      {
        currentPlan: plan,
        stepIndex: 0,
        attempt: 0,
        replans: 0,
        iterations: {},
        passed: false,
        patchedStep: false,
        repeatStep: false,
        done: false,
        ok: true,
        config,
      },
      thread,
    );

    // Handle LangGraph interrupts (HITL — human-in-the-loop).
    // The graph may pause at a destructive-action guard; consult the approver
    // and resume, or fail immediately if the approver rejects.
    while (this.hasInterrupt(state)) {
      const interrupts = (state as Record<string, unknown>).__interrupt__ as Array<{ value: { action: unknown; reason: string; stepId: string; policy: string } }>;
      for (const intr of interrupts) {
        const approved = await this.approver.approve({
          action: intr.value.action as import('../../domain/schemas/action.schema.js').QaAction,
          reason: intr.value.reason,
          stepId: intr.value.stepId,
          policy: intr.value.policy as import('../../domain/schemas/execution-plan.schema.js').DestructiveActionPolicy,
        });
        if (!approved) {
          return stateToResult(
            {
              ...state,
              ok: false,
              done: true,
              failedMessage: intr.value.reason,
            } as unknown as PlanExecutionGraphState,
            plan,
          );
        }
      }
      state = await graph.invoke(new Command({ resume: true }), { ...thread, recursionLimit: 100 });
    }

    return stateToResult(state, plan);
  }

  private hasInterrupt(state: unknown): boolean {
    return state !== null && typeof state === 'object' && '__interrupt__' in state && Array.isArray((state as Record<string, unknown>).__interrupt__);
  }
}
