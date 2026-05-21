import type { QaActionEnvelope } from '../../domain/schemas/action.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { ExecutionPlan, ExecutionStep, PlanPatch, ReplanReason } from '../../domain/schemas/execution-plan.schema.js';

export interface DecisionInput {
  config: RunConfig;
  observation: ScreenObservation;
  runData: Record<string, string>;
}

export interface ReplanInput {
  config: RunConfig;
  plan: ExecutionPlan;
  failedStep: ExecutionStep;
  observation: ScreenObservation;
  reason: ReplanReason;
  message: string;
  history: Array<{ stepId: string; reason: ReplanReason; message: string }>;
  runData: Record<string, string>;
}

export interface DecisionProviderPort {
  plan?(config: RunConfig): Promise<QaScenario[]>;
  buildPlan?(config: RunConfig, scenarios?: QaScenario[]): Promise<ExecutionPlan>;
  replan?(input: ReplanInput): Promise<PlanPatch>;
  decide(input: DecisionInput): Promise<QaActionEnvelope>;
  stats?(): { calls: number; tokensIn?: number; tokensOut?: number; wrappers?: unknown };
}
