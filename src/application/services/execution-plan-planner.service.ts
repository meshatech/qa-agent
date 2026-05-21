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
    if (this.decision.buildPlan) {
      try {
        const plan = this.alignRuntime(ExecutionPlanSchema.parse(await this.decision.buildPlan(config, scenarios)), config);
        this.validateSemanticPlan(plan, config, scenarios);
        return { plan, source: 'llm' };
      } catch (error) {
        const fallback = this.factory.fromScenarios(config, scenarios);
        return { plan: fallback, source: 'factory', fallbackReason: this.fallbackReason(error) };
      }
    }
    return { plan: this.factory.fromScenarios(config, scenarios), source: 'factory' };
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
    if (this.containsGenericPlaceholder(plan)) {
      issues.push('plan contains generic placeholder UI labels instead of app-specific locators or semantic candidates');
    }
    if (this.hasInvalidAppearanceState(plan)) {
      issues.push('appearance ui_state uses invalid expected value; use expected "changed" or a concrete runtime condition');
    }
    const weakThemeStep = plan.steps.find((step) => this.isThemeAction(step) && !this.hasStateChangePostcondition(step));
    if (weakThemeStep) {
      issues.push(`theme/appearance step "${weakThemeStep.id}" lacks a changed ui_state/attribute_state/storage_state postcondition`);
    }
    const weakLogoutStep = plan.steps.find((step) => this.isLogoutClick(step) && !this.hasLogoutProof(step));
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
    const actionText = this.lowerJson({ description: step.description, action: step.action });
    const opensLoginRoute = step.action.type === 'navigate' && /\/(login|signin|sign-in|auth)\b/.test(step.action.to.toLowerCase());
    const fillsCredential = step.action.type === 'fill' && /\b(email|e-mail|password|senha|palavra-passe|username|login)\b/.test(actionText);
    const clicksLogin = step.action.type === 'click' && /\b(login|sign in|signin|entrar|acessar)\b/.test(actionText);
    const describesLogin = /\b(open|abrir|fill|preencher|click|clicar|submit|enviar)\b[\s\S]{0,40}\b(login|sign in|signin|entrar|senha|password)\b/.test(actionText);
    return opensLoginRoute || fillsCredential || clicksLogin || describesLogin;
  }

  private containsGenericPlaceholder(plan: ExecutionPlan): boolean {
    const text = this.collectUserFacingStrings(plan).join(' | ').toLowerCase();
    return [
      /\bauthenticated area\b/,
      /\bnew theme\b/,
      /\blogin form\b/,
      /\blogin button\b/,
      /\blogout button\b/,
      /\bchange theme\b/,
      /\btheme changed\b/,
    ].some((pattern) => pattern.test(text));
  }

  private collectUserFacingStrings(plan: ExecutionPlan): string[] {
    const values: string[] = [];
    const collectLocator = (locator: unknown): void => {
      if (!locator || typeof locator !== 'object') return;
      const item = locator as Record<string, unknown>;
      for (const key of ['name', 'text', 'value']) {
        if (typeof item[key] === 'string') values.push(item[key]);
      }
      if (Array.isArray(item.texts)) values.push(...item.texts.filter((text): text is string => typeof text === 'string'));
      if (Array.isArray(item.candidates)) item.candidates.forEach(collectLocator);
    };
    const collectCondition = (condition: PlanCondition): void => {
      if (condition.type === 'text_visible') values.push(condition.text);
      if (condition.type === 'text_any_visible') values.push(...condition.texts);
      if ('target' in condition) collectLocator(condition.target);
    };
    for (const step of plan.steps) {
      if ('target' in step.action) collectLocator(step.action.target);
      step.preconditions.forEach(collectCondition);
      step.postconditions.forEach(collectCondition);
      step.assertions.forEach(collectCondition);
    }
    plan.assertions.forEach(collectCondition);
    return values;
  }

  private hasInvalidAppearanceState(plan: ExecutionPlan): boolean {
    return [...plan.steps.flatMap((step) => step.postconditions), ...plan.steps.flatMap((step) => step.assertions), ...plan.assertions]
      .some((condition) => condition.type === 'ui_state'
        && condition.semanticKey === 'appearance_mode'
        && typeof condition.expected === 'string'
        && !['changed', 'unchanged', 'exists', 'not_exists', 'dark', 'light'].includes(condition.expected.toLowerCase()));
  }

  private isThemeAction(step: ExecutionStep): boolean {
    const text = this.lowerJson({ description: step.description, action: step.action });
    return /\b(theme|tema|appearance|apar[eê]ncia|visual mode|modo visual)\b/.test(text);
  }

  private hasStateChangePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['ui_state', 'attribute_state', 'storage_state'].includes(condition.type)
      && 'expected' in condition
      && condition.expected === 'changed');
  }

  private isPassiveAction(step: ExecutionStep): boolean {
    return step.action.type === 'waitForStable' || step.action.type === 'assertVisible';
  }

  private hasChangedRuntimePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['ui_state', 'attribute_state', 'storage_state', 'menu_state', 'auth_state', 'route_state'].includes(condition.type)
      && 'expected' in condition
      && condition.expected === 'changed');
  }

  private isLogoutClick(step: ExecutionStep): boolean {
    if (step.action.type !== 'click') return false;
    const actionText = this.lowerJson(step.action);
    const description = step.description.toLowerCase();
    return /\b(sair|logout|log out|sign out|signout)\b/.test(actionText)
      || /\b(click|clicar|selecionar|confirmar)\b[\s\S]{0,40}\b(sair|logout|log out|sign out|signout)\b/.test(description);
  }

  private hasLogoutProof(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => this.isLogoutProofCondition(condition));
  }

  private isLogoutProofCondition(condition: PlanCondition): boolean {
    if (condition.type === 'auth_state') return condition.expected === 'anonymous';
    if (condition.type === 'route_state') {
      const pattern = `${condition.expectedUrl ?? ''} ${condition.expectedUrlPattern ?? ''}`.toLowerCase();
      return condition.expected === 'matches' && /\/(login|signin|sign-in|auth)\b/.test(pattern);
    }
    if (condition.type === 'url_contains') return /(login|signin|sign-in|auth)/i.test(condition.value);
    if (condition.type === 'text_visible') return /^(entrar|login|sign in|e-mail|email|senha|password|palavra-passe)$/i.test(condition.text.trim());
    if (condition.type === 'text_any_visible') return condition.texts.some((text) => /^(entrar|login|sign in|e-mail|email|senha|password|palavra-passe)$/i.test(text.trim()));
    return false;
  }

  private lowerJson(value: unknown): string {
    return JSON.stringify(value).toLowerCase();
  }
}
