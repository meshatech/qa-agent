import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import type { QaScenario } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { ExecutionPlanSchema, type ExecutionPlan, type ExecutionStep, type PlanCondition } from '../../domain/schemas/execution-plan.schema.js';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import { ExecutionPlanBuildError } from '../../domain/errors.js';
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
  private readonly logger = new Logger(ExecutionPlanPlannerService.name);

  constructor(
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
    @Inject(ExecutionPlanFactoryService) private readonly factory: ExecutionPlanFactoryService,
  ) {}

  async build(config: RunConfig, scenarios: QaScenario[]): Promise<PlannedExecutionPlan> {
    if (config.runtime.planning?.executionPlanStrategy === 'factory_first') {
      const factoryPlan = await this.factory.fromScenarios(config, scenarios);
      if (factoryPlan) {
        return { plan: factoryPlan, source: 'factory' };
      }
      this.logger.warn('factory_first strategy produced no plan; attempting LLM buildPlan fallback');
      if (this.decision.buildPlan) {
        try {
          const plan = this.alignRuntime(ExecutionPlanSchema.parse(await this.decision.buildPlan(config, scenarios)), config);
          this.validateSemanticPlan(plan, config, scenarios);
          return { plan, source: 'llm', fallbackReason: 'factory_first produced no steps; used LLM buildPlan' };
        } catch (error) {
          throw new ExecutionPlanBuildError(`factory_first produced no steps and LLM fallback failed: ${this.fallbackReason(error)}`);
        }
      }
      if (config.runtime.planning?.allowEmergencyPlan) {
        this.logger.warn('factory_first produced no steps and no LLM fallback available; generating emergency plan');
        const plan = this.makeEmergencyPlan(config);
        this.validateSemanticPlan(plan, config, scenarios);
        return { plan, source: 'factory', fallbackReason: 'factory_first produced no steps and no LLM fallback; using emergency navigation plan' };
      }
      throw new ExecutionPlanBuildError('factory_first produced no steps and no LLM fallback available');
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
    for (const step of plan.steps) {
      if (step.scenarioId === 'emergency' && step.taskId === 'emergency') continue;
      if (!step.scenarioId || !scenarioIds.has(step.scenarioId)) {
        this.logger.warn(`Step "${step.id}" references unknown scenarioId "${step.scenarioId}"; cannot validate theme/logout safety`);
      } else if (!step.taskId || !taskIds.has(step.taskId)) {
        this.logger.warn(`Step "${step.id}" references unknown taskId "${step.taskId}"; cannot validate theme/logout safety`);
      }
    }
    if (taskIds.size > 0 && plan.steps.some((step) => {
      if (step.scenarioId === 'emergency' && step.taskId === 'emergency') return false;
      return !step.taskId || !taskIds.has(step.taskId) || !step.scenarioId || !scenarioIds.has(step.scenarioId);
    })) {
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
    for (const step of plan.steps) {
      if (step.action.type !== 'click' && step.action.type !== 'fill') continue;
      const task = this.findTask(step, scenarios);
      if (!task?.expectedOutcome) continue;
      const targetTexts = this.extractLocatorTexts(step.action.target);
      const lowerTexts = targetTexts.map((t) => t.toLowerCase());
      const genericMappings: { keywords: string[]; expectedKind: string }[] = [
        { keywords: ['login', 'entrar', 'sign in'], expectedKind: 'AUTHENTICATION' },
        { keywords: ['logout', 'sair', 'sign out'], expectedKind: 'DEAUTHENTICATION' },
        { keywords: ['theme', 'appearance', 'dark mode', 'light mode'], expectedKind: 'APPEARANCE_CHANGE' },
      ];
      for (const mapping of genericMappings) {
        if (lowerTexts.some((t) => mapping.keywords.some((k) => t.includes(k))) && task.expectedOutcome.kind !== mapping.expectedKind) {
          issues.push(`step "${step.id}" target contains generic keyword "${mapping.keywords[0]}" but expectedOutcome is ${task.expectedOutcome.kind}; refine target or expectedOutcome`);
        }
      }
    }
    for (const step of plan.steps) {
      if (step.scenarioId !== 'emergency' || step.taskId !== 'emergency') continue;
      if (step.action.type === 'navigate') {
        try {
          const url = new URL(step.action.to);
          if (!['http:', 'https:'].includes(url.protocol)) {
            issues.push(`emergency step "${step.id}" uses unsupported protocol "${url.protocol}"`);
          }
          if (url.host !== new URL(config.baseUrl).host) {
            issues.push(`emergency step "${step.id}" navigates to external host "${url.host}"`);
          }
        } catch {
          issues.push(`emergency step "${step.id}" has invalid navigate URL "${step.action.to}"`);
        }
      }
      if (step.action.type === 'click' || step.action.type === 'fill') {
        const targetTexts = this.extractLocatorTexts(step.action.target);
        const placeholders = ['click here', 'button', 'submit', 'fill here'];
        if (targetTexts.some((t) => placeholders.includes(t.toLowerCase()))) {
          issues.push(`emergency step "${step.id}" uses generic placeholder target "${targetTexts[0]}"`);
        }
      }
    }
    if (issues.length > 0) throw new SemanticPlanPolicyError(issues.join('; '));
  }

  private stepAttemptsRuntimeLogin(step: ExecutionStep): boolean {
    if (step.action.type === 'navigate') {
      return step.action.to.toLowerCase().includes('/login');
    }
    if (step.action.type === 'fill') {
      const targetTexts = this.extractLocatorTexts(step.action.target);
      return targetTexts.some((t) => /email|password|senha|usuário|username/i.test(t));
    }
    if (step.action.type === 'click') {
      const targetTexts = this.extractLocatorTexts(step.action.target);
      return targetTexts.some((t) => /login|entrar|sign.in|log.in/i.test(t));
    }
    return false;
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
    if (task?.expectedOutcome?.kind === 'APPEARANCE_CHANGE') return true;
    if (!task) return false;
    const targetTexts = step.action.type === 'click' || step.action.type === 'fill' ? this.extractLocatorTexts(step.action.target) : [];
    const description = (task?.expected ?? task?.title ?? '').toLowerCase();
    return targetTexts.some((t) => /theme|tema|aparência|appearance|dark|light|modo/i.test(t)) || /theme|tema|aparência|appearance|dark|light|modo/i.test(description);
  }

  private hasStateChangePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['ui_state', 'attribute_state', 'storage_state'].includes(condition.type)
      && 'expected' in condition
      && condition.expected === 'changed');
  }

  private hasVerifiedStatePostcondition(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => ['auth_state', 'ui_state', 'attribute_state', 'storage_state', 'menu_state', 'element_visible', 'text_visible', 'text_any_visible', 'field_value_contains'].includes(condition.type));
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
    if (task?.expectedOutcome?.kind === 'DEAUTHENTICATION') return true;
    if (!task) return false;
    const targetTexts = this.extractLocatorTexts(step.action.target);
    const description = (task?.expected ?? task?.title ?? '').toLowerCase();
    return targetTexts.some((t) => /logout|sair|sign.out|deslogar|encerrar/i.test(t)) || /logout|sair|sign.out|deslogar|encerrar/i.test(description);
  }

  private hasLogoutProof(step: ExecutionStep): boolean {
    return step.postconditions.some((condition) => this.isLogoutProofCondition(condition));
  }

  private isLogoutProofCondition(condition: PlanCondition): boolean {
    if (condition.type === 'auth_state') return condition.expected === 'anonymous';
    if (condition.type === 'route_state') {
      const loginPaths = ['/login', '/signin', '/auth'];
      return condition.expected === 'matches'
        && loginPaths.some((path) => condition.expectedUrlPattern?.includes(path) ?? false);
    }
    if (condition.type === 'url_contains') return Boolean(condition.value);
    if (condition.type === 'text_visible') return Boolean(condition.text);
    if (condition.type === 'text_any_visible') return condition.texts.length > 0;
    return false;
  }

  private makeEmergencyPlan(config: RunConfig): ExecutionPlan {
    return {
      schemaVersion: 'execution-plan.v1',
      planId: `emergency_${config.demand.id}`,
      version: 1,
      goal: `${config.demand.title} (emergency fallback)`,
      mode: config.runtime.mode,
      runtime: {
        maxAttemptsPerStep: config.runtime.maxAttemptsPerStep,
        maxReplansPerScenario: config.runtime.maxReplansPerScenario,
        destructiveActionPolicy: config.runtime.destructiveActionPolicy,
      },
      steps: [{
        id: 'emergency-navigate',
        scenarioId: 'emergency',
        taskId: 'emergency',
        description: 'Navigate to base URL and verify page stability',
        preconditions: [],
        action: { type: 'navigate', to: config.baseUrl, reason: 'Emergency fallback navigation to base URL' },
        postconditions: [{ type: 'route_state', expected: 'matches', expectedUrlPattern: config.baseUrl }],
        assertions: [{ type: 'no_console_errors' }],
        onFailure: 'BLOCK',
      }],
      assertions: [],
    };
  }

  private extractLocatorTexts(target: LocatorDescriptor): string[] {
    const texts: string[] = [];
    if ('texts' in target && Array.isArray(target.texts)) {
      texts.push(...target.texts);
    }
    if ('text' in target && typeof target.text === 'string') {
      texts.push(target.text);
    }
    if ('name' in target && typeof target.name === 'string') {
      texts.push(target.name);
    }
    if ('semanticKey' in target && typeof target.semanticKey === 'string') {
      texts.push(target.semanticKey);
    }
    if ('intent' in target && typeof target.intent === 'string') {
      texts.push(target.intent);
    }
    if ('candidates' in target && Array.isArray(target.candidates)) {
      for (const candidate of target.candidates) {
        texts.push(...this.extractLocatorTexts(candidate));
      }
    }
    return texts;
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
