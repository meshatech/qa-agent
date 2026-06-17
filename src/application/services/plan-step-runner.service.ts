import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { AssertionResult, QaStep, QuiescenceResult } from '../../domain/models/run.model.js';
import type { BoundExpectedAfterAction, QaAction } from '../../domain/schemas/action.schema.js';
import type { DecisionProviderPort } from '../ports/decision-provider.port.js';
import type { ExecutionPlan, ExecutionStep, PlanCondition, ReplanReason, RuntimeStateSnapshot } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import { DomainError } from '../../domain/shared/result.js';
import { ActionPolicyService } from './action-policy.service.js';
import { DataHarnessService } from './data-harness.service.js';
import { ElementAvailabilityResolver, type EnsureElementAvailablePolicy } from './element-availability-resolver.service.js';
import { LocatorResolverService } from './locator-resolver.service.js';
import { PlanReplannerService } from './plan-replanner.service.js';
import { RecoveryPolicyService } from './recovery-policy.service.js';
import { TaskMemoryService } from './task-memory.service.js';
import { NetworkStateValidatorService } from './network-state-validator.service.js';
import { type ConditionEvaluationResult, type LocatorTelemetryEvent, type PlanExecutionResult } from './plan-executor.service.js';

@Injectable()
export class PlanStepRunnerService {
  private readonly logger = new Logger('PlanStepRunnerService');

  constructor(
    @Inject('BrowserHarnessPort') readonly browser: BrowserHarnessPort,
    @Inject(LocatorResolverService) readonly locators: LocatorResolverService,
    @Inject(DataHarnessService) readonly data: DataHarnessService,
    @Inject(ActionPolicyService) readonly actionPolicy: ActionPolicyService,
    @Inject(ElementAvailabilityResolver) readonly availability: ElementAvailabilityResolver,
    @Inject(RecoveryPolicyService) readonly recovery: RecoveryPolicyService,
    @Inject(TaskMemoryService) readonly memory: TaskMemoryService,
    @Inject(PlanReplannerService) readonly replanner: PlanReplannerService,
    @Inject('DecisionProviderPort') readonly decision: DecisionProviderPort,
    @Inject(NetworkStateValidatorService) readonly networkValidator: NetworkStateValidatorService,
  ) {}

  async observe(step: ExecutionStep): Promise<ScreenObservation> {
    const obs = await this.browser.observe();
    this.locators.rebuild(obs);
    if (step.scenarioId && step.taskId) this.memory.observe(step.scenarioId, step.taskId, obs);
    return obs;
  }

  async checkAll(conditions: PlanCondition[], obs: ScreenObservation, beforeState?: RuntimeStateSnapshot, afterState?: RuntimeStateSnapshot): Promise<AssertionResult> {
    for (const condition of conditions) {
      const resolved = this.data.resolveObject(condition, 'assertion');
      if (resolved.type === 'network_state') {
        const networkResult = this.networkValidator.validate(resolved, obs);
        if (networkResult) {
          if (!networkResult.ok) return networkResult;
          continue;
        }
      }
      const runtime = this.checkRuntimeCondition(resolved, obs, beforeState, afterState);
      if (runtime) {
        if (!runtime.ok) return runtime;
        continue;
      }
      if (resolved.type === 'text_any_visible') {
        const ok = resolved.texts.some((text) => this.hasText(obs, text));
        if (!ok) return { ok: false, type: 'text_any_visible', expected: resolved.texts.join(' | '), actual: obs.visibleTexts.slice(0, 6).join(' | '), durationMs: 0 };
        continue;
      }
      const validation = await this.browser.validate(this.boundCondition(resolved, obs));
      if (!validation.ok) return validation;
    }
    return { ok: true, type: 'conditions', durationMs: 0 };
  }

  resolveAction(step: ExecutionStep, obs: ScreenObservation, result: PlanExecutionResult): QaAction {
    const action = this.data.resolveObject(step.action, 'action');
    if (action.type === 'click') return { type: 'click', targetElementId: this.resolveLocator(step, obs, result, action.target), reason: action.reason };
    if (action.type === 'fill') return { type: 'fill', targetElementId: this.resolveLocator(step, obs, result, action.target), value: action.value, reason: action.reason };
    if (action.type === 'select') return { type: 'select', targetElementId: this.resolveLocator(step, obs, result, action.target), option: action.option, reason: action.reason };
    if (action.type === 'press') return { type: 'press', key: action.key, targetElementId: action.target ? this.resolveLocator(step, obs, result, action.target) : undefined, reason: action.reason };
    if (action.type === 'assertVisible') return { type: 'assertVisible', targetElementId: action.target ? this.resolveLocator(step, obs, result, action.target) : undefined, text: action.text, reason: action.reason };
    if (action.type === 'drag') return { type: 'drag', sourceElementId: this.resolveLocator(step, obs, result, action.source), targetElementId: this.resolveLocator(step, obs, result, action.target), reason: action.reason };
    if (action.type === 'uploadFile') return { type: 'uploadFile', targetElementId: this.resolveLocator(step, obs, result, action.target), filePath: action.filePath, reason: action.reason };
    if (action.type === 'richTextFill') return { type: 'richTextFill', targetElementId: this.resolveLocator(step, obs, result, action.target), value: action.value, reason: action.reason };
    if (action.type === 'extract') return { type: 'extract', targetElementId: this.resolveLocator(step, obs, result, action.target), key: action.key, source: action.source, reason: action.reason };
    return action;
  }

  resolveLocator(step: ExecutionStep, obs: ScreenObservation, result: PlanExecutionResult, locator: import('../../domain/schemas/action.schema.js').LocatorDescriptor): string {
    const elementId = this.locators.findByLocator(obs, locator);
    const resolved = this.locators.resolve(obs.observationId, elementId);
    this.logger.log(`[PlanStepRunner] resolveLocator step=${step.id} elementId=${elementId} humanName="${resolved.humanName ?? '?'}" strategy=${locator.strategy}`);
    const isSemanticFallback = locator.strategy === 'semantic';
    const telemetryEvent: LocatorTelemetryEvent = {
      stepId: step.id,
      type: isSemanticFallback ? 'semantic_fallback' : 'deterministic_resolution',
      locatorStrategy: locator.strategy,
      elementId,
      timestamp: new Date().toISOString(),
    };
    result.locatorTelemetry.push(telemetryEvent);
    return elementId;
  }

  async resolveViaLlm(step: ExecutionStep, obs: ScreenObservation, config: RunConfig): Promise<QaAction> {
    const envelope = await this.decision.decide({
      config,
      observation: obs,
      runData: {
        stepDescription: step.description,
        stepIntent: (step.action as { target?: { intent?: string } }).target?.intent ?? step.description,
        stepActionType: (step.action as { type: string }).type,
      },
    });
    return envelope.action;
  }

  async ensureActionTargetAvailable(step: ExecutionStep, obs: ScreenObservation, config: RunConfig) {
    const action = this.data.resolveObject(step.action, 'action');
    const target = 'target' in action ? action.target : undefined;
    if (!target) return { available: false, observation: obs, reobserved: false, reason: 'NOT_FOUND' as const, attempts: [] };
    return this.availability.ensureAvailable({ target, observation: obs, config, policy: this.elementAvailabilityPolicy(step, config) });
  }

  async runtimeState(obs: ScreenObservation, conditions: PlanCondition[]): Promise<RuntimeStateSnapshot> {
    return this.browser.runtimeState?.(obs, conditions) ?? {
      observationId: obs.observationId,
      url: obs.url,
      semanticStates: this.semanticStates(obs),
      attributes: {},
      storage: {},
      timestamp: new Date().toISOString(),
    };
  }

  semanticStates(obs: ScreenObservation): Record<string, unknown> {
    const text = [...obs.visibleTexts, ...obs.elements.flatMap((e) => [e.name, e.text ?? ''])].join(' | ');
    const loginRoute = /\/(login|signin|sign-in|auth)\b/i.test(obs.url);
    const loginFormText = /\b(entrar|login|senha|password|sign in|acessar)\b/i.test(text) && /\b(senha|password)\b/i.test(text);
    const interactiveSurface = obs.elements.some((element) =>
      element.inViewport && ['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem'].includes(element.role),
    );
    return {
      auth: loginRoute || (loginFormText && !interactiveSurface) ? 'anonymous' : 'authenticated',
      menuOpen: obs.elements.some((element) => element.inViewport && (element.expanded === true || element.role === 'menuitem')),
      appearance_mode: text.slice(0, 4000),
      visibleTextSignature: text.slice(0, 500),
    };
  }

  checkRuntimeCondition(condition: PlanCondition, obs: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): AssertionResult | undefined {
    if (!['ui_state', 'auth_state', 'menu_state', 'route_state', 'attribute_state', 'storage_state'].includes(condition.type)) return undefined;
    const current = after ?? before;
    if (!current) return { ok: false, type: condition.type, expected: JSON.stringify(condition), actual: 'runtime state unavailable', durationMs: 0 };
    const value = this.runtimeValue(condition, current);
    const beforeValue = before ? this.runtimeValue(condition, before) : undefined;
    const ok = this.matchesRuntimeExpected(condition, value, beforeValue, obs, before, after);
    return { ok, type: condition.type, expected: this.expectedText(condition), actual: this.actualText(value, beforeValue), durationMs: 0 };
  }

  runtimeValue(condition: PlanCondition, state: RuntimeStateSnapshot): unknown {
    if (condition.type === 'ui_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.visibleTextSignature;
    if (condition.type === 'auth_state') return state.semanticStates.auth;
    if (condition.type === 'menu_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.menuOpen;
    if (condition.type === 'route_state') return state.url;
    if (condition.type === 'attribute_state') return state.attributes[`${JSON.stringify(condition.target)}::${condition.attribute}`];
    if (condition.type === 'storage_state') return state.storage[`${condition.storage}:${condition.key}`];
    return undefined;
  }

  matchesRuntimeExpected(condition: PlanCondition, value: unknown, beforeValue: unknown, obs: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): boolean {
    const expected = 'expected' in condition ? condition.expected : undefined;
    if (expected === 'changed') return JSON.stringify(beforeValue ?? before) !== JSON.stringify(value ?? after);
    if (expected === 'unchanged' || expected === 'same') return JSON.stringify(beforeValue ?? before) === JSON.stringify(value ?? after);
    if (expected === 'exists') return value !== undefined && value !== null && value !== false && value !== '';
    if (expected === 'not_exists') return value === undefined || value === null || value === false || value === '';
    if (condition.type === 'route_state' && condition.expected === 'matches') {
      if (condition.expectedUrl && after?.url) return after.url.includes(condition.expectedUrl);
      if (condition.expectedUrlPattern && after?.url) return new RegExp(condition.expectedUrlPattern).test(after.url);
    }
    if (condition.type === 'auth_state') return value === expected;
    if (condition.type === 'menu_state' && expected === 'open') {
      if (value === true) return true;
      const keys = condition.semanticKey.split('|').map((s) => s.trim()).filter(Boolean);
      return keys.some((k) => this.hasText(obs, k));
    }
    if (condition.type === 'menu_state' && expected === 'closed') return value === false;
    return expected === undefined ? true : String(value).toLowerCase().includes(String(expected).toLowerCase());
  }

  expectedText(condition: PlanCondition): string {
    return 'expected' in condition ? String(condition.expected) : JSON.stringify(condition);
  }

  actualText(value: unknown, beforeValue: unknown): string {
    return `before=${JSON.stringify(beforeValue)} after=${JSON.stringify(value)}`.slice(0, 300);
  }

  hasText(obs: ScreenObservation, text: string): boolean {
    return [...obs.visibleTexts, ...obs.elements.flatMap((e) => [e.name, e.text ?? '', e.ariaLabel ?? '', e.title ?? '', e.alt ?? '', e.className ?? ''])].some((value) => value.toLowerCase().includes(text.toLowerCase()));
  }

  async recordAccessibilityWarnings(result: PlanExecutionResult, stepId: string): Promise<void> {
    const auditResult = await this.browser.auditAccessibility?.().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/has been closed|Target page|context or browser has been closed/i.test(message)) {
        result.warnings.push({ stepId, message: `Accessibility audit failed: ${message}` });
      }
      return [];
    });
    const violations = auditResult ?? [];
    const relevantImpacts = new Set(['critical', 'serious']);
    for (const violation of violations) {
      const impact = violation.impact ?? 'unknown';
      if (relevantImpacts.has(impact)) {
        result.warnings.push({ stepId, message: `WCAG_${violation.id} [${impact}]: ${violation.description}` });
      }
    }
  }

  elementAvailabilityPolicy(step: ExecutionStep, config: RunConfig): EnsureElementAvailablePolicy {
    const elementAvailability = config.runtime.elementAvailability;
    return {
      enabled: elementAvailability.enabled,
      maxOpenAttempts: elementAvailability.maxOpenAttempts,
      allowClickOutside: elementAvailability.allowClickOutside,
      allowGlobalEscape: elementAvailability.allowGlobalEscape,
      allowedContainers: elementAvailability.allowedContainers,
    };
  }

  conditionEvaluations(step: ExecutionStep, phase: ConditionEvaluationResult['phase'], conditions: PlanCondition[], result: AssertionResult, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): ConditionEvaluationResult[] {
    if (!conditions.length) return [{ conditionId: `${step.id}:${phase}:none`, stepId: step.id, phase, type: result.type, passed: result.ok, expected: result.expected, actual: result.actual, before, after, severity: result.ok ? 'INFO' : 'ERROR', reason: result.ok ? 'conditions passed' : result.actual ?? 'condition failed' }];
    return conditions.map((condition, index) => ({
      conditionId: `${step.id}:${phase}:${index + 1}`,
      stepId: step.id,
      phase,
      type: condition.type,
      passed: result.ok || result.type !== condition.type,
      expected: 'expected' in condition ? condition.expected : 'text' in condition ? condition.text : 'texts' in condition ? condition.texts : condition,
      actual: result.type === condition.type ? result.actual : undefined,
      before,
      after,
      severity: result.ok || result.type !== condition.type ? 'INFO' : 'ERROR',
      reason: result.ok || result.type !== condition.type ? 'condition passed' : result.actual ?? 'condition failed',
    }));
  }

  planStep(step: ExecutionStep, obs: ScreenObservation, action: QaAction, resolvedAction: QaAction, boundExpected: BoundExpectedAfterAction, validation: AssertionResult, quiescence?: QuiescenceResult, error?: string): QaStep {
    return {
      stepId: step.id,
      scenarioId: step.scenarioId,
      taskId: step.taskId,
      observationId: obs.observationId,
      thoughtSummary: step.description,
      confidence: 1,
      action,
      resolvedAction,
      boundExpected,
      validation,
      quiescence,
      error: error ? { code: 'RECOVERY_EXHAUSTED', message: error } : undefined,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  fail(result: PlanExecutionResult, step: QaStep, obs: ScreenObservation, message: string): PlanExecutionResult {
    if (!result.steps.includes(step)) result.steps.push(step);
    return { ...result, ok: false, failedStep: step, failedObservation: obs, failedMessage: message };
  }

  waitAction(reason: string): QaAction {
    return { type: 'waitForStable', timeoutMs: 1000, reason };
  }

  boundCondition(condition: PlanCondition, obs: ScreenObservation): BoundExpectedAfterAction {
    const current = this.data.resolveObject(condition, 'assertion');
    if (current.type === 'field_value_contains') return { type: 'field_value_contains', target: this.target(obs, current.target), value: current.value };
    if (current.type === 'element_visible') return { type: 'element_visible', target: current.target ? this.target(obs, current.target) : undefined, text: current.text };
    if (current.type === 'text_any_visible') return { type: 'text_visible', text: current.texts[0] ?? '' };
    if (current.type === 'text_visible' || current.type === 'url_contains' || current.type === 'no_console_errors') return current;
    return { type: 'no_console_errors' };
  }

  target(obs: ScreenObservation, locator: import('../../domain/schemas/action.schema.js').LocatorDescriptor) {
    const id = this.locators.findByLocator(obs, locator);
    const resolved = this.locators.resolve(obs.observationId, id);
    return { originalElementId: id, observationId: obs.observationId, locator: resolved.locator, humanName: resolved.humanName };
  }

  async tryReplan(input: {
    result: PlanExecutionResult;
    config: RunConfig;
    currentPlan: ExecutionPlan;
    step: ExecutionStep;
    before: ScreenObservation;
    reason: ReplanReason;
    message: string;
    replans: number;
  }): Promise<ExecutionPlan | undefined> {
    input.result.locatorTelemetry.push({ stepId: input.step.id, type: 'replan', timestamp: new Date().toISOString() });
    if (input.currentPlan.mode === 'PLAN_AND_EXECUTE') return undefined;
    if (input.replans >= input.currentPlan.runtime.maxReplansPerScenario) return undefined;
    try {
      const applied = await this.replanner.replan({
        config: input.config,
        plan: input.currentPlan,
        failedStep: input.step,
        observation: input.before,
        reason: input.reason,
        message: input.message,
        history: input.result.patchHistory.map((item) => ({ stepId: String(item.stepId ?? ''), reason: String(item.replanReason ?? input.reason) as ReplanReason, message: String(item.reason ?? '') })),
        runData: this.data.all(),
      });
      input.result.patchHistory.push({ ...applied.history, rawReason: input.message });
      if (applied.history.status === 'BLOCKED') return undefined;
      return applied.plan;
    } catch (error) {
      input.result.patchHistory.push({
        status: 'BLOCKED',
        stepId: input.step.id,
        replanReason: input.reason,
        reason: error instanceof DomainError || error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
