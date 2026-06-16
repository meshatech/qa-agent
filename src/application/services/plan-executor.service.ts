import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { AttemptRecord, QaStep } from '../../domain/models/run.model.js';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { ExecutionPlan, ExecutionStep } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RuntimeStateSnapshot } from '../../domain/schemas/execution-plan.schema.js';
import { PlanStepRunnerService } from './plan-step-runner.service.js';

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
  private readonly logger = new Logger('PlanExecutorService');

  constructor(
    @Inject(PlanStepRunnerService) private readonly runner: PlanStepRunnerService,
  ) {}

  async execute(plan: ExecutionPlan, config: RunConfig): Promise<PlanExecutionResult> {
    return this.runExecution(plan, config);
  }

  private async runExecution(plan: ExecutionPlan, config: RunConfig): Promise<PlanExecutionResult> {
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
        let before = await this.runner.observe(step);
        const beforeState = await this.runner.runtimeState(before, [...step.preconditions, ...step.postconditions, ...step.assertions]);
        const pre = await this.runner.checkAll(step.preconditions, before, beforeState);
        result.evaluations.push(...this.runner.conditionEvaluations(step, 'precondition', step.preconditions, pre, beforeState, beforeState));
        if (!pre.ok) {
          const warning = `Precondition failed: ${pre.actual ?? pre.expected ?? pre.type}`;
          if (step.onFailure === 'CONTINUE_WITH_WARNING') {
            result.warnings.push({ stepId: step.id, message: warning });
            passed = true;
            break;
          }
          const patched = await this.runner.tryReplan({ result, config, currentPlan, step, before, reason: 'PRECONDITION_FAILED', message: warning, replans });
          if (patched) {
            currentPlan = patched;
            result.finalPlan = currentPlan;
            replans++;
            patchedStep = true;
            passed = true;
            break;
          }
          return this.runner.fail(result, this.runner.planStep(step, before, this.runner.waitAction(warning), this.runner.waitAction(warning), { type: 'no_console_errors' }, pre, undefined, warning), before, warning);
        }

        const stepAction = this.runner.data.resolveObject(step.action, 'action');
        if (stepAction.type === 'click' && 'target' in stepAction && stepAction.target && config.runtime.elementAvailability.enabled) {
          this.logger.log(`[PlanExecutor] step=${step.id} proactive ensureActionTargetAvailable`);
          const available = await this.runner.ensureActionTargetAvailable(step, before, config);
          result.attempts.push(...available.attempts);
          if (available.reobserved) before = available.observation;
        }

        let action: QaAction;
        try {
          action = this.runner.resolveAction(step, before, result);
        } catch (error) {
          result.locatorTelemetry.push({ stepId: step.id, type: 'target_not_found', timestamp: new Date().toISOString() });
          await this.runner.recordAccessibilityWarnings(result, step.id);
          this.logger.log(`[PlanExecutor] step=${step.id} target_not_found → ensureActionTargetAvailable`);
          const available = await this.runner.ensureActionTargetAvailable(step, before, config);
          result.attempts.push(...available.attempts);
          if (available.available) {
            before = available.observation;
            action = this.runner.resolveAction(step, before, result);
          } else {
            const message = error instanceof Error ? error.message : String(error);
            try {
              action = await this.runner.resolveViaLlm(step, before, config);
              result.locatorTelemetry.push({ stepId: step.id, type: 'llm_decide', timestamp: new Date().toISOString() });
            } catch {
              const patched = await this.runner.tryReplan({ result, config, currentPlan, step, before, reason: 'LOCATOR_NOT_FOUND', message, replans });
              if (patched) {
                currentPlan = patched;
                result.finalPlan = currentPlan;
                replans++;
                patchedStep = true;
                passed = true;
                break;
              }
              throw error;
            }
          }
        }
        const policy = this.runner.actionPolicy.validate(action, config, result.attempts);
        const destructive = this.runner.actionPolicy.validateDestructiveText(`${step.description} ${'reason' in action ? action.reason : ''}`, config);
        if (!policy.ok || !destructive.ok) {
          const message = !policy.ok ? policy.message : !destructive.ok ? destructive.message : 'action policy failed';
          return this.runner.fail(result, this.runner.planStep(step, before, action, action, { type: 'no_console_errors' }, { ok: false, type: 'policy', actual: message, durationMs: 0 }, undefined, message), before, message);
        }

        this.logger.log(`[PlanExecutor] step=${step.id} task=${step.taskId} attempt=${attempt + 1} action=${JSON.stringify({ type: action.type, reason: 'reason' in action ? action.reason : undefined, targetElementId: 'targetElementId' in action ? action.targetElementId : undefined })}`);
        const exec = await this.runner.browser.execute(action);
        this.logger.log(`[PlanExecutor] step=${step.id} actionResult=${exec.ok ? 'PASSED' : 'FAILED'} durationMs=${exec.durationMs}${exec.error ? ` error=${exec.error.message}` : ''}`);
        if (exec.ok && action.type === 'extract' && exec.data !== undefined) this.runner.data.storeValue(action.key, exec.data);
        const record: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
        result.attempts.push(record);
        if (step.scenarioId && step.taskId) this.runner.memory.action(step.scenarioId, step.taskId, action, record.result);

        let quiescence: import('../../domain/models/run.model.js').QuiescenceResult | undefined;
        const isFastSuccess = exec.ok && (exec.durationMs ?? 0) < 1000;
        if (!isFastSuccess) {
          quiescence = await this.runner.browser.waitForQuiescence(config.timeouts.quiescenceMs);
          if (!quiescence.stable) {
            result.warnings.push({ stepId: step.id, message: 'QUIESCENCE_TIMEOUT' });
            result.attempts.push({ actionType: 'waitForQuiescence', result: 'FAILED', reason: 'QUIESCENCE_TIMEOUT', ts: new Date().toISOString() });
          }
        }

        const after = await this.runner.observe(step);
        if (action.type === 'navigate' || action.type === 'compareScreenshot') await this.runner.recordAccessibilityWarnings(result, step.id);
        const afterState = await this.runner.runtimeState(after, [...step.postconditions, ...step.assertions]);
        const post = await this.runner.checkAll(step.postconditions, after, beforeState, afterState);
        result.evaluations.push(...this.runner.conditionEvaluations(step, 'postcondition', step.postconditions, post, beforeState, afterState));
        if (!exec.ok || !post.ok) {
          const recovered = await this.runner.recovery.recover({
            expected: this.runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after),
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
          const recoveredObs = recovered.ok ? await this.runner.observe(step) : after;
          const recoveredState = recovered.ok ? await this.runner.runtimeState(recoveredObs, step.postconditions) : afterState;
          const validation = recovered.ok ? await this.runner.checkAll(step.postconditions, recoveredObs, beforeState, recoveredState) : post;
          const qaStep = this.runner.planStep(step, after, action, action, this.runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), validation, quiescence, validation.ok ? undefined : 'RECOVERY_EXHAUSTED');
          result.steps.push(qaStep);
          if (!validation.ok) {
            const patched = await this.runner.tryReplan({ result, config, currentPlan, step, before: after, reason: recovered.ok ? 'POSTCONDITION_FAILED' : 'RECOVERY_FAILED', message: validation.actual ?? 'postcondition failed', replans });
            if (patched) {
              currentPlan = patched;
              result.finalPlan = currentPlan;
              replans++;
              patchedStep = true;
              passed = true;
              break;
            }
            return this.runner.fail(result, qaStep, after, validation.actual ?? 'postcondition failed');
          }
          passed = true;
          break;
        }

        const business = await this.runner.checkAll(step.assertions, after, beforeState, afterState);
        result.evaluations.push(...this.runner.conditionEvaluations(step, 'businessAssertion', step.assertions, business, beforeState, afterState));
        if (!business.ok) {
          const qaStep = this.runner.planStep(step, after, action, action, this.runner.boundCondition(step.assertions[0] ?? step.postconditions[0] ?? { type: 'no_console_errors' }, after), business, quiescence, 'business assertion failed');
          result.steps.push(qaStep);
          const patched = await this.runner.tryReplan({ result, config, currentPlan, step, before: after, reason: 'ASSERTION_FAILED', message: business.actual ?? 'business assertion failed', replans });
          if (patched) {
            currentPlan = patched;
            result.finalPlan = currentPlan;
            replans++;
            patchedStep = true;
            passed = true;
            break;
          }
          return this.runner.fail(result, qaStep, after, business.actual ?? 'business assertion failed');
        }
        result.steps.push(this.runner.planStep(step, after, action, action, this.runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), post, quiescence));
        if (step.repeatUntil) {
          const repeated = await this.runner.checkAll([step.repeatUntil], after, beforeState, afterState);
          if (!repeated.ok) {
            const iteration = (iterations.get(step.id) ?? 1) + 1;
            if (iteration > (step.maxIterations ?? 10)) return this.runner.fail(result, result.steps.at(-1)!, after, `repeatUntil exhausted after ${iteration - 1} iterations`);
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
    const finalObs = await this.runner.browser.observe();
    this.runner.locators.rebuild(finalObs);
    const finalState = await this.runner.runtimeState(finalObs, plan.assertions);
    const finalAssertions = await this.runner.checkAll(plan.assertions, finalObs, finalState, finalState);
    if (!finalAssertions.ok) {
      const action = this.runner.waitAction('final business assertion failed');
      const step = this.runner.planStep({ id: 'PLAN_ASSERTIONS', description: 'Final business assertions', preconditions: [], action: { type: 'waitForStable', reason: 'final business assertion check' }, postconditions: plan.assertions, assertions: [], onFailure: 'BLOCK' } as unknown as ExecutionStep, finalObs, action, action, this.runner.boundCondition(plan.assertions[0] ?? { type: 'no_console_errors' }, finalObs), finalAssertions, undefined, 'business assertion failed');
      return this.runner.fail(result, step, finalObs, finalAssertions.actual ?? 'business assertion failed');
    }
    return result;
  }

  // Expose runner for use-case level access (stats, etc.)
  get stepRunner(): PlanStepRunnerService {
    return this.runner;
  }
}

// Re-export RuntimeStateSnapshot for test compat
export type { RuntimeStateSnapshot };
