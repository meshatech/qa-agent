import { Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ExecutionPlanSchema, type ExecutionPlan, type ExecutionStep, type PlanCondition } from '../../domain/schemas/execution-plan.schema.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import { ExecutionPlanFactoryService } from './execution-plan-factory.service.js';

export type ExecutionPlanSource = 'llm' | 'factory' | 'manual';

export interface PlannedExecutionPlan {
  plan: ExecutionPlan | undefined;
  source: ExecutionPlanSource;
  fallbackReason?: string;
}

class SemanticPlanPolicyError extends Error {
  constructor(message: string) {
    super(`LLM buildPlan returned semantically unsafe ExecutionPlan: ${message}`);
  }
}

@Injectable()
export class ExecutionPlanPlannerService {
  constructor(
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject(ExecutionPlanFactoryService) private readonly factory: ExecutionPlanFactoryService,
  ) {}

  async build(config: RunConfig, scenarios: QaScenario[]): Promise<PlannedExecutionPlan> {
    if (config.runtime.planning?.executionPlanStrategy === 'factory_first') {
      return { plan: await this.factory.fromScenarios(config, scenarios), source: 'factory' };
    }
    if (this.decision.buildPlan) {
      try {
        const plan = this.alignRuntime(ExecutionPlanSchema.parse(await this.decision.buildPlan(config, scenarios)), config);
        this.validateSemanticPlan(plan, config, scenarios);
        return { plan, source: 'llm' };
      } catch (error) {
        const fallback = await this.factory.fromScenarios(config, scenarios);
        return { plan: fallback, source: 'factory', fallbackReason: this.fallbackReason(error) };
      }
    }
    return { plan: await this.factory.fromScenarios(config, scenarios), source: 'factory' };
  }

  private fallbackReason(error: unknown): string {
    if (error instanceof ZodError) {
      const issueSummary = error.issues
        .slice(0, 4)
        .map((issue) => {
          const path = issue.path.length ? issue.path.join('.') : '<root>';
          const extra = 'keys' in issue && Array.isArray(issue.keys) ? ` (${issue.keys.join(', ')})` : '';
          return `${path}: ${issue.message}${extra}`;
        })
        .join('; ');
      const suffix = error.issues.length > 4 ? `; +${error.issues.length - 4} more` : '';
      return `LLM buildPlan returned invalid ExecutionPlan (${error.issues.length} schema issues: ${issueSummary}${suffix})`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private alignRuntime(plan: ExecutionPlan, config: RunConfig): ExecutionPlan {
    return ExecutionPlanSchema.parse({
      ...plan,
      mode: config.runtime.mode,
      runtime: {
        maxAttemptsPerStep: config.runtime.maxAttemptsPerStep,
        maxReplansPerScenario: config.runtime.maxReplansPerScenario,
        destructiveActionPolicy: config.runtime.destructiveActionPolicy,
      },
    });
  }

  private validateSemanticPlan(plan: ExecutionPlan, config: RunConfig, scenarios: QaScenario[]): void {
    const issues: string[] = [];
    const taskIds = new Set(scenarios.flatMap((scenario) => scenario.tasks.map((task) => task.id)));
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    if (taskIds.size > 0 && plan.steps.some((step) => !step.taskId || !taskIds.has(step.taskId) || !step.scenarioId || !scenarioIds.has(step.scenarioId))) {
      issues.push('plan steps must preserve scenarioId/taskId from scenarioCatalog');
    }
    if (config.auth.kind !== 'none' && plan.steps.some((step) => this.stepAttemptsRuntimeLogin(step))) {
      issues.push('auth is already handled, but plan contains login-form/login-page actions');
    }
    if (this.hasInvalidAppearanceState(plan)) {
      issues.push('appearance ui_state uses invalid expected value; use expected "changed" or a concrete runtime condition');
    }
    const unsafeClickStep = plan.steps.find((step) => step.action.type === 'click' && !this.hasVerifiedStatePostcondition(step));
    if (unsafeClickStep) {
      issues.push(`click step "${unsafeClickStep.id}" has no state-changing postcondition; may execute destructive action without verification`);
    }
    const weakThemeStep = plan.steps.find((step) => this.isThemeAction(step, scenarios) && !this.hasStateChangePostcondition(step));
    if (weakThemeStep) {
      issues.push(`theme/appearance step "${weakThemeStep.id}" lacks a changed ui_state/attribute_state/storage_state postcondition`);
    }
    const weakLogoutStep = plan.steps.find((step) => this.isLogoutClick(step, scenarios) && !this.hasLogoutProof(step));
    if (weakLogoutStep) {
      issues.push(`logout step "${weakLogoutStep.id}" does not prove anonymous state or login route`);
    }
    const impossibleChangedStep = plan.steps.find((step) => this.isPassiveAction(step) && this.hasChangedRuntimePostcondition(step));
    if (impossibleChangedStep) {
      issues.push(`passive step "${impossibleChangedStep.id}" cannot expect runtime state changed`);
    }
    if (issues.length > 0) throw new SemanticPlanPolicyError(issues.join('; '));
  }

  private stepAttemptsRuntimeLogin(step: ExecutionStep): boolean {
    return step.action.type === 'navigate' && step.action.to.toLowerCase().includes('/login');
  }

  private hasInvalidAppearanceState(plan: ExecutionPlan): boolean {
    return [...plan.steps.flatMap((step) => step.postconditions), ...plan.steps.flatMap((step) => step.assertions), ...plan.assertions]
      .some((condition) => condition.type === 'ui_state'
        && condition.semanticKey === 'appearance_mode'
        && typeof condition.expected === 'string'
        && !['changed', 'unchanged', 'exists', 'not_exists', 'dark', 'light'].includes(condition.expected.toLowerCase()));
  }

  private isThemeAction(step: ExecutionStep, scenarios: QaScenario[]): boolean {
    const task = this.findTask(step, scenarios);
    return task?.expectedOutcome?.kind === 'APPEARANCE_CHANGE' || false;
  }

  private hasStateChangePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['ui_state', 'attribute_state', 'storage_state'].includes(condition.type)
      && 'expected' in condition
      && condition.expected === 'changed');
  }

  private hasVerifiedStatePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['auth_state', 'ui_state', 'attribute_state', 'storage_state'].includes(condition.type));
  }

  private isPassiveAction(step: ExecutionStep): boolean {
    return step.action.type === 'waitForStable' || step.action.type === 'assertVisible';
  }

  private hasChangedRuntimePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['ui_state', 'attribute_state', 'storage_state', 'menu_state', 'auth_state', 'route_state'].includes(condition.type)
      && 'expected' in condition
      && condition.expected === 'changed');
  }

  private isLogoutClick(step: ExecutionStep, scenarios: QaScenario[]): boolean {
    if (step.action.type !== 'click') return false;
    const task = this.findTask(step, scenarios);
    return task?.expectedOutcome?.kind === 'DEAUTHENTICATION' || false;
  }

  private hasLogoutProof(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => this.isLogoutProofCondition(condition));
  }

  private isLogoutProofCondition(condition: PlanCondition): boolean {
    if (condition.type === 'auth_state') return condition.expected === 'anonymous';
    if (condition.type === 'route_state') return condition.expected === 'matches' && Boolean(condition.expectedUrlPattern);
    if (condition.type === 'url_contains') return Boolean(condition.value);
    if (condition.type === 'text_visible') return Boolean(condition.text);
    if (condition.type === 'text_any_visible') return condition.texts.length > 0;
    return false;
  }

  private findTask(step: ExecutionStep, scenarios: QaScenario[]): QaScenario['tasks'][number] | undefined {
    for (const scenario of scenarios) {
      if (scenario.id === step.scenarioId) {
        return scenario.tasks.find((task) => task.id === step.taskId);
      }
    }
    return undefined;
  }
}
