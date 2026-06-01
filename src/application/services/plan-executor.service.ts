import { Inject, Injectable } from '@nestjs/common';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { AssertionResult, AttemptRecord, QaStep, QuiescenceResult } from '../../domain/models/run.model.js';
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

export interface LocatorTelemetryEvent {
  stepId: string;
  type: 'deterministic_resolution' | 'semantic_fallback' | 'llm_decide' | 'replan' | 'target_not_found';
  locatorStrategy?: string;
  elementId?: string;
  timestamp: string;
}

export interface PlanExecutionResult {
  ok: boolean;
  steps: QaStep[];
  attempts: AttemptRecord[];
  warnings: Array<{ stepId: string; message: string }>;
  finalPlan: ExecutionPlan;
  patchHistory: Array<Record<string, unknown>>;
  evaluations: ConditionEvaluationResult[];
  locatorTelemetry: LocatorTelemetryEvent[];
  failedStep?: QaStep;
  failedObservation?: ScreenObservation;
  failedMessage?: string;
}

export interface ConditionEvaluationResult {
  conditionId: string;
  stepId: string;
  phase: 'precondition' | 'postcondition' | 'businessAssertion';
  type: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  before?: unknown;
  after?: unknown;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  reason: string;
}

@Injectable()
export class PlanExecutorService {
  constructor(
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
    @Inject(LocatorResolverService) private readonly locators: LocatorResolverService,
    @Inject(DataHarnessService) private readonly data: DataHarnessService,
    @Inject(ActionPolicyService) private readonly actionPolicy: ActionPolicyService,
    @Inject(ElementAvailabilityResolver) private readonly availability: ElementAvailabilityResolver,
    @Inject(RecoveryPolicyService) private readonly recovery: RecoveryPolicyService,
    @Inject(TaskMemoryService) private readonly memory: TaskMemoryService,
    @Inject(PlanReplannerService) private readonly replanner: PlanReplannerService,
    @Inject('DecisionProviderPort') private readonly decision: DecisionProviderPort,
  ) {}

  async execute(plan: ExecutionPlan, config: RunConfig): Promise<PlanExecutionResult> {
    let currentPlan = plan;
    let stepIndex = 0;
    let replans = 0;
    const iterations = new Map<string, number>();
    const result: PlanExecutionResult = { ok: true, steps: [], attempts: [], warnings: [], finalPlan: currentPlan, patchHistory: [], evaluations: [], locatorTelemetry: [] };
    while (stepIndex < currentPlan.steps.length) {
      const step = currentPlan.steps[stepIndex]!;
      const attempts = step.maxAttempts ?? currentPlan.runtime.maxAttemptsPerStep;
      let passed = false;
      let patchedStep = false;
      let repeatStep = false;
      for (let attempt = 0; attempt < attempts && !passed; attempt++) {
        let before = await this.observe(step);
        const beforeState = await this.runtimeState(before, [...step.preconditions, ...step.postconditions, ...step.assertions]);
        const pre = await this.checkAll(step.preconditions, before, beforeState);
        result.evaluations.push(...this.conditionEvaluations(step, 'precondition', step.preconditions, pre, beforeState, beforeState));
        if (!pre.ok) {
          const warning = `Precondition failed: ${pre.actual ?? pre.expected ?? pre.type}`;
          if (step.onFailure === 'CONTINUE_WITH_WARNING') {
            result.warnings.push({ stepId: step.id, message: warning });
            passed = true;
            break;
          }
          const patched = await this.tryReplan({ result, config, currentPlan, step, before, reason: 'PRECONDITION_FAILED', message: warning, replans });
          if (patched) {
            currentPlan = patched;
            result.finalPlan = currentPlan;
            replans++;
            patchedStep = true;
            passed = true;
            break;
          }
          return this.fail(result, this.planStep(step, before, this.waitAction(warning), this.waitAction(warning), { type: 'no_console_errors' }, pre, undefined, warning), before, warning);
        }

        let action: QaAction;
        try {
          action = this.resolveAction(step, before, result);
        } catch (error) {
          result.locatorTelemetry.push({ stepId: step.id, type: 'target_not_found', timestamp: new Date().toISOString() });
          await this.recordAccessibilityWarnings(result, step.id);
          const available = await this.ensureActionTargetAvailable(step, before, config);
          result.attempts.push(...available.attempts);
          if (available.available) {
            before = available.observation;
            action = this.resolveAction(step, before, result);
          } else {
            const message = error instanceof Error ? error.message : String(error);
            const patched = await this.tryReplan({ result, config, currentPlan, step, before, reason: 'LOCATOR_NOT_FOUND', message, replans });
            if (patched) {
              currentPlan = patched;
              result.finalPlan = currentPlan;
              replans++;
              patchedStep = true;
              passed = true;
              break;
            }
            // Fallback: ask LLM to resolve the concrete action from current observation
            try {
              action = await this.resolveViaLlm(step, before, config);
              result.locatorTelemetry.push({ stepId: step.id, type: 'llm_decide', timestamp: new Date().toISOString() });
            } catch {
              throw error;
            }
          }
        }
        const policy = this.actionPolicy.validate(action, config, result.attempts);
        const destructive = this.actionPolicy.validateDestructiveText(`${step.description} ${'reason' in action ? action.reason : ''}`, config);
        if (!policy.ok || !destructive.ok) {
          const message = !policy.ok ? policy.message : !destructive.ok ? destructive.message : 'action policy failed';
          return this.fail(result, this.planStep(step, before, action, action, { type: 'no_console_errors' }, { ok: false, type: 'policy', actual: message, durationMs: 0 }, undefined, message), before, message);
        }

        const exec = await this.browser.execute(action);
        if (exec.ok && action.type === 'extract' && exec.data !== undefined) this.data.storeValue(action.key, exec.data);
        const record: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
        result.attempts.push(record);
        if (step.scenarioId && step.taskId) this.memory.action(step.scenarioId, step.taskId, action, record.result);

        let quiescence: QuiescenceResult | undefined;
        const isFastSuccess = exec.ok && (exec.durationMs ?? 0) < 1000;
        if (!isFastSuccess) {
          quiescence = await this.browser.waitForQuiescence(config.timeouts.quiescenceMs);
          if (!quiescence.stable) {
            result.warnings.push({ stepId: step.id, message: 'QUIESCENCE_TIMEOUT' });
            result.attempts.push({ actionType: 'waitForQuiescence', result: 'FAILED', reason: 'QUIESCENCE_TIMEOUT', ts: new Date().toISOString() });
          }
        }

        const after = await this.observe(step);
        if (action.type === 'navigate' || action.type === 'compareScreenshot') await this.recordAccessibilityWarnings(result, step.id);
        const afterState = await this.runtimeState(after, [...step.postconditions, ...step.assertions]);
        const post = await this.checkAll(step.postconditions, after, beforeState, afterState);
        result.evaluations.push(...this.conditionEvaluations(step, 'postcondition', step.postconditions, post, beforeState, afterState));
        if (!exec.ok || !post.ok) {
          const recovered = await this.recovery.recover({
            expected: this.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after),
            fallback: { type: 'press', key: 'Escape', reason: 'plan step recovery escape' },
            attempts: result.attempts,
            quiescenceMs: config.timeouts.quiescenceMs,
            maxFallbacks: config.recovery.maxFallbacksPerStep,
            maxEmergencyActions: config.recovery.maxEmergencyActionsPerScenario,
            beforeObservation: after,
          });
          if (!recovered.ok && step.onFailure === 'CONTINUE_WITH_WARNING') {
            result.warnings.push({ stepId: step.id, message: post.actual ?? 'postcondition failed' });
            passed = true;
            break;
          }
          const recoveredObs = recovered.ok ? await this.observe(step) : after;
          const recoveredState = recovered.ok ? await this.runtimeState(recoveredObs, step.postconditions) : afterState;
          const validation = recovered.ok ? await this.checkAll(step.postconditions, recoveredObs, beforeState, recoveredState) : post;
          const qaStep = this.planStep(step, after, action, action, this.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), validation, quiescence, validation.ok ? undefined : 'RECOVERY_EXHAUSTED');
          result.steps.push(qaStep);
          if (!validation.ok) {
            const patched = await this.tryReplan({ result, config, currentPlan, step, before: after, reason: recovered.ok ? 'POSTCONDITION_FAILED' : 'RECOVERY_FAILED', message: validation.actual ?? 'postcondition failed', replans });
            if (patched) {
              currentPlan = patched;
              result.finalPlan = currentPlan;
              replans++;
              patchedStep = true;
              passed = true;
              break;
            }
            return this.fail(result, qaStep, after, validation.actual ?? 'postcondition failed');
          }
          passed = true;
          break;
        }

        const business = await this.checkAll(step.assertions, after, beforeState, afterState);
        result.evaluations.push(...this.conditionEvaluations(step, 'businessAssertion', step.assertions, business, beforeState, afterState));
        if (!business.ok) {
          const qaStep = this.planStep(step, after, action, action, this.boundCondition(step.assertions[0] ?? step.postconditions[0] ?? { type: 'no_console_errors' }, after), business, quiescence, 'business assertion failed');
          result.steps.push(qaStep);
          const patched = await this.tryReplan({ result, config, currentPlan, step, before: after, reason: 'ASSERTION_FAILED', message: business.actual ?? 'business assertion failed', replans });
          if (patched) {
            currentPlan = patched;
            result.finalPlan = currentPlan;
            replans++;
            patchedStep = true;
            passed = true;
            break;
          }
          return this.fail(result, qaStep, after, business.actual ?? 'business assertion failed');
        }
        result.steps.push(this.planStep(step, after, action, action, this.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), post, quiescence));
        if (step.repeatUntil) {
          const repeated = await this.checkAll([step.repeatUntil], after, beforeState, afterState);
          if (!repeated.ok) {
            const iteration = (iterations.get(step.id) ?? 1) + 1;
            if (iteration > (step.maxIterations ?? 10)) return this.fail(result, result.steps.at(-1)!, after, `repeatUntil exhausted after ${iteration - 1} iterations`);
            iterations.set(step.id, iteration);
            repeatStep = true;
          }
        }
        passed = true;
      }
      if (!passed) return { ...result, ok: false, failedMessage: 'maxAttemptsPerStep exhausted' };
      if (patchedStep) continue;
      if (repeatStep) continue;
      stepIndex++;
    }
    const finalObs = await this.browser.observe();
    this.locators.rebuild(finalObs);
    const finalState = await this.runtimeState(finalObs, plan.assertions);
    const finalAssertions = await this.checkAll(plan.assertions, finalObs, finalState, finalState);
    if (!finalAssertions.ok) {
      const action = this.waitAction('final business assertion failed');
      const step = this.planStep({ id: 'PLAN_ASSERTIONS', description: 'Final business assertions', preconditions: [], action: { type: 'waitForStable', reason: 'final business assertion check' }, postconditions: plan.assertions, assertions: [], onFailure: 'BLOCK' }, finalObs, action, action, this.boundCondition(plan.assertions[0] ?? { type: 'no_console_errors' }, finalObs), finalAssertions, undefined, 'business assertion failed');
      return this.fail(result, step, finalObs, finalAssertions.actual ?? 'business assertion failed');
    }
    return result;
  }

  private async tryReplan(input: {
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

  private async observe(step: ExecutionStep): Promise<ScreenObservation> {
    const obs = await this.browser.observe();
    this.locators.rebuild(obs);
    if (step.scenarioId && step.taskId) this.memory.observe(step.scenarioId, step.taskId, obs);
    return obs;
  }

  private async checkAll(conditions: PlanCondition[], obs: ScreenObservation, beforeState?: RuntimeStateSnapshot, afterState?: RuntimeStateSnapshot): Promise<AssertionResult> {
    for (const condition of conditions) {
      const resolved = this.data.resolveObject(condition, 'assertion');
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

  private resolveAction(step: ExecutionStep, obs: ScreenObservation, result: PlanExecutionResult): QaAction {
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

  private resolveLocator(step: ExecutionStep, obs: ScreenObservation, result: PlanExecutionResult, locator: import('../../domain/schemas/action.schema.js').LocatorDescriptor): string {
    const elementId = this.locators.findByLocator(obs, locator);
    const isSemanticFallback = locator.strategy === 'semantic';
    result.locatorTelemetry.push({
      stepId: step.id,
      type: isSemanticFallback ? 'semantic_fallback' : 'deterministic_resolution',
      locatorStrategy: locator.strategy,
      elementId,
      timestamp: new Date().toISOString(),
    });
    return elementId;
  }

  private async resolveViaLlm(step: ExecutionStep, obs: ScreenObservation, config: RunConfig): Promise<QaAction> {
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

  private boundCondition(condition: PlanCondition, obs: ScreenObservation): BoundExpectedAfterAction {
    const current = this.data.resolveObject(condition, 'assertion');
    if (current.type === 'field_value_contains') return { type: 'field_value_contains', target: this.target(obs, current.target), value: current.value };
    if (current.type === 'element_visible') return { type: 'element_visible', target: current.target ? this.target(obs, current.target) : undefined, text: current.text };
    if (current.type === 'text_any_visible') return { type: 'text_visible', text: current.texts[0] ?? '' };
    if (current.type === 'text_visible' || current.type === 'url_contains' || current.type === 'no_console_errors') return current;
    return { type: 'no_console_errors' };
  }

  private target(obs: ScreenObservation, locator: import('../../domain/schemas/action.schema.js').LocatorDescriptor) {
    const id = this.locators.findByLocator(obs, locator);
    const resolved = this.locators.resolve(obs.observationId, id);
    return { originalElementId: id, observationId: obs.observationId, locator: resolved.locator, humanName: resolved.humanName };
  }

  private hasText(obs: ScreenObservation, text: string): boolean {
    return [...obs.visibleTexts, ...obs.elements.flatMap((e) => [e.name, e.text ?? '', e.ariaLabel ?? '', e.title ?? '', e.alt ?? '', e.className ?? ''])].some((value) => value.toLowerCase().includes(text.toLowerCase()));
  }

  private async runtimeState(obs: ScreenObservation, conditions: PlanCondition[]): Promise<RuntimeStateSnapshot> {
    return this.browser.runtimeState?.(obs, conditions) ?? {
      observationId: obs.observationId,
      url: obs.url,
      semanticStates: this.semanticStates(obs),
      attributes: {},
      storage: {},
      timestamp: new Date().toISOString(),
    };
  }

  private semanticStates(obs: ScreenObservation): Record<string, unknown> {
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

  private checkRuntimeCondition(condition: PlanCondition, obs: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): AssertionResult | undefined {
    if (!['ui_state', 'auth_state', 'menu_state', 'route_state', 'attribute_state', 'storage_state'].includes(condition.type)) return undefined;
    const current = after ?? before;
    if (!current) return { ok: false, type: condition.type, expected: JSON.stringify(condition), actual: 'runtime state unavailable', durationMs: 0 };
    const value = this.runtimeValue(condition, current);
    const beforeValue = before ? this.runtimeValue(condition, before) : undefined;
    const ok = this.matchesRuntimeExpected(condition, value, beforeValue, obs, before, after);
    return { ok, type: condition.type, expected: this.expectedText(condition), actual: this.actualText(value, beforeValue), durationMs: 0 };
  }

  private runtimeValue(condition: PlanCondition, state: RuntimeStateSnapshot): unknown {
    if (condition.type === 'ui_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.visibleTextSignature;
    if (condition.type === 'auth_state') return state.semanticStates.auth;
    if (condition.type === 'menu_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.menuOpen;
    if (condition.type === 'route_state') return state.url;
    if (condition.type === 'attribute_state') return state.attributes[`${JSON.stringify(condition.target)}::${condition.attribute}`];
    if (condition.type === 'storage_state') return state.storage[`${condition.storage}:${condition.key}`];
    return undefined;
  }

  private matchesRuntimeExpected(condition: PlanCondition, value: unknown, beforeValue: unknown, obs: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): boolean {
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
    if (condition.type === 'menu_state' && expected === 'open') return value === true || this.hasText(obs, condition.semanticKey);
    if (condition.type === 'menu_state' && expected === 'closed') return value === false;
    return expected === undefined ? true : String(value).toLowerCase().includes(String(expected).toLowerCase());
  }

  private expectedText(condition: PlanCondition): string {
    return 'expected' in condition ? String(condition.expected) : JSON.stringify(condition);
  }

  private actualText(value: unknown, beforeValue: unknown): string {
    return `before=${JSON.stringify(beforeValue)} after=${JSON.stringify(value)}`.slice(0, 300);
  }

  private async ensureActionTargetAvailable(step: ExecutionStep, obs: ScreenObservation, config: RunConfig) {
    const action = this.data.resolveObject(step.action, 'action');
    const target = 'target' in action ? action.target : undefined;
    if (!target) return { available: false, observation: obs, reobserved: false, reason: 'NOT_FOUND' as const, attempts: [] };
    return this.availability.ensureAvailable({ target, observation: obs, config, policy: this.elementAvailabilityPolicy(step, config) });
  }

  private async recordAccessibilityWarnings(result: PlanExecutionResult, stepId: string): Promise<void> {
    const auditResult = await this.browser.auditAccessibility?.().catch((error: unknown) => {
      result.warnings.push({ stepId, message: `Accessibility audit failed: ${error instanceof Error ? error.message : String(error)}` });
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

  private elementAvailabilityPolicy(step: ExecutionStep, config: RunConfig): EnsureElementAvailablePolicy {
    const elementAvailability = config.runtime.elementAvailability;
    return {
      enabled: elementAvailability.enabled,
      maxOpenAttempts: elementAvailability.maxOpenAttempts,
      allowClickOutside: elementAvailability.allowClickOutside,
      allowGlobalEscape: elementAvailability.allowGlobalEscape,
      allowedContainers: elementAvailability.allowedContainers,
    };
  }

  private conditionEvaluations(step: ExecutionStep, phase: ConditionEvaluationResult['phase'], conditions: PlanCondition[], result: AssertionResult, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): ConditionEvaluationResult[] {
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

  private planStep(step: ExecutionStep, obs: ScreenObservation, action: QaAction, resolvedAction: QaAction, boundExpected: BoundExpectedAfterAction, validation: AssertionResult, quiescence?: QuiescenceResult, error?: string): QaStep {
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

  private fail(result: PlanExecutionResult, step: QaStep, obs: ScreenObservation, message: string): PlanExecutionResult {
    if (!result.steps.includes(step)) result.steps.push(step);
    return { ...result, ok: false, failedStep: step, failedObservation: obs, failedMessage: message };
  }

  private waitAction(reason: string): QaAction {
    return { type: 'waitForStable', timeoutMs: 1000, reason };
  }
}
