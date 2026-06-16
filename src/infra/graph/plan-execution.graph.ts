import { Annotation, END, MemorySaver, START, StateGraph, interrupt } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { ExecutionPlan, ExecutionStep, RuntimeStateSnapshot } from '../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { AssertionResult, AttemptRecord, QaStep, QuiescenceResult } from '../../domain/models/run.model.js';
import type { PlanStepRunnerService } from '../../application/services/plan-step-runner.service.js';
import type { ConditionEvaluationResult, LocatorTelemetryEvent, PlanExecutionResult } from '../../application/services/plan-executor.service.js';
import type { DestructiveActionApproverPort } from '../../application/ports/destructive-action-approver.port.js';

// ---------------------------------------------------------------------------
// State annotation
// ---------------------------------------------------------------------------

const PlanExecutionState = Annotation.Root({
  currentPlan: Annotation<ExecutionPlan>({ reducer: (_, b) => b }),
  stepIndex: Annotation<number>({ reducer: (_, b) => b }),
  attempt: Annotation<number>({ reducer: (_, b) => b }),
  replans: Annotation<number>({ reducer: (_, b) => b }),
  iterations: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }) }),
  before: Annotation<ScreenObservation | undefined>({ reducer: (_, b) => b }),
  after: Annotation<ScreenObservation | undefined>({ reducer: (_, b) => b }),
  beforeState: Annotation<RuntimeStateSnapshot | undefined>({ reducer: (_, b) => b }),
  afterState: Annotation<RuntimeStateSnapshot | undefined>({ reducer: (_, b) => b }),
  currentAction: Annotation<QaAction | undefined>({ reducer: (_, b) => b }),
  lastExecResult: Annotation<{ ok: boolean; durationMs?: number; error?: { message: string; code?: string }; data?: unknown } | undefined>({ reducer: (_, b) => b }),
  lastValidation: Annotation<AssertionResult | undefined>({ reducer: (_, b) => b }),
  lastQuiescence: Annotation<QuiescenceResult | undefined>({ reducer: (_, b) => b }),
  passed: Annotation<boolean>({ reducer: (_, b) => b }),
  patchedStep: Annotation<boolean>({ reducer: (_, b) => b }),
  repeatStep: Annotation<boolean>({ reducer: (_, b) => b }),
  done: Annotation<boolean>({ reducer: (_, b) => b }),
  steps: Annotation<QaStep[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  attempts: Annotation<AttemptRecord[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  warnings: Annotation<Array<{ stepId: string; message: string }>>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  patchHistory: Annotation<Array<Record<string, unknown>>>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  evaluations: Annotation<ConditionEvaluationResult[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  locatorTelemetry: Annotation<LocatorTelemetryEvent[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  failedStep: Annotation<QaStep | undefined>({ reducer: (_, b) => b }),
  failedObservation: Annotation<ScreenObservation | undefined>({ reducer: (_, b) => b }),
  failedMessage: Annotation<string | undefined>({ reducer: (_, b) => b }),
  ok: Annotation<boolean>({ reducer: (_, b) => b }),
  config: Annotation<RunConfig>({ reducer: (_, b) => b }),
});

type State = typeof PlanExecutionState.State;

// ---------------------------------------------------------------------------
// Helpers: build ephemeral PlanExecutionResult view and diff mutations back
// ---------------------------------------------------------------------------

function makeResultView(state: State): PlanExecutionResult {
  return {
    ok: state.ok,
    steps: [...state.steps],
    attempts: [...state.attempts],
    warnings: [...state.warnings],
    finalPlan: state.currentPlan,
    patchHistory: [...state.patchHistory],
    evaluations: [...state.evaluations],
    locatorTelemetry: [...state.locatorTelemetry],
    failedStep: state.failedStep,
    failedObservation: state.failedObservation,
    failedMessage: state.failedMessage,
  };
}

function diffResult(before: PlanExecutionResult, after: PlanExecutionResult): Partial<State> {
  return {
    steps: after.steps.slice(before.steps.length),
    attempts: after.attempts.slice(before.attempts.length),
    warnings: after.warnings.slice(before.warnings.length),
    patchHistory: after.patchHistory.slice(before.patchHistory.length),
    evaluations: after.evaluations.slice(before.evaluations.length),
    locatorTelemetry: after.locatorTelemetry.slice(before.locatorTelemetry.length),
  };
}

// ---------------------------------------------------------------------------
// Compiled graph contract (avoids exposing complex LangGraph internal types)
// ---------------------------------------------------------------------------
export interface CompiledGraph {
  invoke(
    input: unknown,
    config?: { configurable?: Record<string, unknown>; recursionLimit?: number },
  ): Promise<PlanExecutionGraphState>;
}

// ---------------------------------------------------------------------------
// Graph factory — uses builder chain so TypeScript infers node names correctly
// ---------------------------------------------------------------------------

export function buildPlanExecutionGraph(runner: PlanStepRunnerService, approver: DestructiveActionApproverPort, logger: Logger = new Logger('PlanExecutionGraph')): CompiledGraph {

  // Node implementations defined as closures over runner/approver

  const observeNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const obs = await runner.observe(step);
    const beforeState = await runner.runtimeState(obs, [...step.preconditions, ...step.postconditions, ...step.assertions]);
    return { before: obs, beforeState, attempt: 0, passed: false, patchedStep: false, repeatStep: false };
  };

  const precheckNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const snap = makeResultView(state);
    const pre = await runner.checkAll(step.preconditions, state.before!, state.beforeState);
    const evals = runner.conditionEvaluations(step, 'precondition', step.preconditions, pre, state.beforeState, state.beforeState);
    return { ...diffResult(snap, { ...snap, evaluations: [...snap.evaluations, ...evals] }), evaluations: evals, lastValidation: pre };
  };

  const resolveActionNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const snap = makeResultView(state);
    let before = state.before!;

    const stepAction = runner.data.resolveObject(step.action, 'action');
    if (stepAction.type === 'click' && 'target' in stepAction && stepAction.target && state.config.runtime.elementAvailability.enabled) {
      const available = await runner.ensureActionTargetAvailable(step, before, state.config);
      snap.attempts.push(...available.attempts);
      if (available.reobserved) before = available.observation;
    }

    try {
      const action = runner.resolveAction(step, before, snap);
      return { ...diffResult(makeResultView(state), snap), before, currentAction: action };
    } catch (error) {
      snap.locatorTelemetry.push({ stepId: step.id, type: 'target_not_found', timestamp: new Date().toISOString() });
      await runner.recordAccessibilityWarnings(snap, step.id);
      const available = await runner.ensureActionTargetAvailable(step, before, state.config);
      snap.attempts.push(...available.attempts);
      if (available.available) {
        before = available.observation;
        const action = runner.resolveAction(step, before, snap);
        return { ...diffResult(makeResultView(state), snap), before, currentAction: action };
      }
      void error;
      try {
        const action = await runner.resolveViaLlm(step, before, state.config);
        snap.locatorTelemetry.push({ stepId: step.id, type: 'llm_decide', timestamp: new Date().toISOString() });
        return { ...diffResult(makeResultView(state), snap), before, currentAction: action };
      } catch {
        return { ...diffResult(makeResultView(state), snap), before, currentAction: undefined };
      }
    }
  };

  const policyGuardNode = (state: State): Partial<State> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const action = state.currentAction;
    if (!action) return {};
    const policy = runner.actionPolicy.validate(action, state.config, state.attempts);
    if (!policy.ok) {
      const qaStep = runner.planStep(step, state.before!, action, action, { type: 'no_console_errors' }, { ok: false, type: 'policy', actual: policy.message, durationMs: 0 }, undefined, policy.message);
      return { ok: false, failedStep: qaStep, failedObservation: state.before, failedMessage: policy.message, steps: [qaStep], done: true };
    }
    return {};
  };

  const destructiveGuardNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const action = state.currentAction!;
    const policy = state.currentPlan.runtime.destructiveActionPolicy;
    if (policy === 'ALLOW') return {};

    const destructive = runner.actionPolicy.validateDestructiveText(`${step.description} ${'reason' in action ? action.reason : ''}`, state.config);
    if (!destructive.ok) {
      interrupt({ action, reason: destructive.message, stepId: step.id, policy });
      const approved = await approver.approve({ action, reason: destructive.message, stepId: step.id, policy });
      if (!approved) {
        const qaStep = runner.planStep(step, state.before!, action, action, { type: 'no_console_errors' }, { ok: false, type: 'policy', actual: destructive.message, durationMs: 0 }, undefined, destructive.message);
        return { ok: false, failedStep: qaStep, failedObservation: state.before, failedMessage: destructive.message, steps: [qaStep], done: true };
      }
    }
    return {};
  };

  const executeNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const action = state.currentAction!;
    logger.log(`[PlanGraph] step=${step.id} task=${step.taskId} attempt=${state.attempt + 1} action=${JSON.stringify({ type: action.type, reason: 'reason' in action ? action.reason : undefined, targetElementId: 'targetElementId' in action ? action.targetElementId : undefined })}`);
    const exec = await runner.browser.execute(action);
    logger.log(`[PlanGraph] step=${step.id} actionResult=${exec.ok ? 'PASSED' : 'FAILED'} durationMs=${exec.durationMs}${exec.error ? ` error=${exec.error.message}` : ''}`);
    if (exec.ok && action.type === 'extract' && exec.data !== undefined) runner.data.storeValue(action.key, exec.data);
    const record: AttemptRecord = { actionType: action.type, result: exec.ok ? 'PASSED' : 'FAILED', reason: exec.error?.message, ts: new Date().toISOString() };
    if (step.scenarioId && step.taskId) runner.memory.action(step.scenarioId, step.taskId, action, record.result);

    let quiescence: QuiescenceResult | undefined;
    const isFastSuccess = exec.ok && (exec.durationMs ?? 0) < 1000;
    if (!isFastSuccess) quiescence = await runner.browser.waitForQuiescence(state.config.timeouts.quiescenceMs);

    const warnings: Array<{ stepId: string; message: string }> = [];
    const extraAttempts: AttemptRecord[] = [];
    if (quiescence && !quiescence.stable) {
      warnings.push({ stepId: step.id, message: 'QUIESCENCE_TIMEOUT' });
      extraAttempts.push({ actionType: 'waitForQuiescence', result: 'FAILED', reason: 'QUIESCENCE_TIMEOUT', ts: new Date().toISOString() });
    }
    return { lastExecResult: exec, lastQuiescence: quiescence, attempts: [record, ...extraAttempts], warnings };
  };

  const observeAfterNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const action = state.currentAction!;
    const after = await runner.observe(step);
    const afterState = await runner.runtimeState(after, [...step.postconditions, ...step.assertions]);
    if (action.type === 'navigate' || action.type === 'compareScreenshot') {
      const snap = makeResultView(state);
      await runner.recordAccessibilityWarnings(snap, step.id);
      return { after, afterState, warnings: snap.warnings.slice(state.warnings.length) };
    }
    return { after, afterState };
  };

  const postcheckNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const exec = state.lastExecResult!;
    const after = state.after!;
    const post = await runner.checkAll(step.postconditions, after, state.beforeState, state.afterState);
    const evals = runner.conditionEvaluations(step, 'postcondition', step.postconditions, post, state.beforeState, state.afterState);

    if (!exec.ok || !post.ok) {
      const recovered = await runner.recovery.recover({
        expected: runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after),
        fallback: { type: 'press', key: 'Escape', reason: 'plan step recovery escape' },
        attempts: state.attempts,
        quiescenceMs: state.config.timeouts.quiescenceMs,
        maxFallbacks: state.config.recovery.maxFallbacksPerStep,
        maxEmergencyActions: state.config.recovery.maxEmergencyActionsPerScenario,
        beforeObservation: after,
      });
      if (!recovered.ok && step.onFailure === 'CONTINUE_WITH_WARNING') {
        return { evaluations: evals, lastValidation: post, warnings: [{ stepId: step.id, message: post.actual ?? 'postcondition failed' }], passed: true };
      }
      const recoveredObs = recovered.ok ? await runner.observe(step) : after;
      const recoveredState = recovered.ok ? await runner.runtimeState(recoveredObs, step.postconditions) : state.afterState;
      const validation = recovered.ok ? await runner.checkAll(step.postconditions, recoveredObs, state.beforeState, recoveredState ?? undefined) : post;
      const qaStep = runner.planStep(step, after, state.currentAction!, state.currentAction!, runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), validation, state.lastQuiescence, validation.ok ? undefined : 'RECOVERY_EXHAUSTED');
      return { evaluations: evals, lastValidation: validation, steps: [qaStep] };
    }
    return { evaluations: evals, lastValidation: post };
  };

  const assertionsNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const after = state.after!;
    const business = await runner.checkAll(step.assertions, after, state.beforeState, state.afterState);
    const evals = runner.conditionEvaluations(step, 'businessAssertion', step.assertions, business, state.beforeState, state.afterState);
    if (!business.ok) {
      const qaStep = runner.planStep(step, after, state.currentAction!, state.currentAction!, runner.boundCondition(step.assertions[0] ?? step.postconditions[0] ?? { type: 'no_console_errors' }, after), business, state.lastQuiescence, 'business assertion failed');
      return { evaluations: evals, lastValidation: business, steps: [qaStep] };
    }
    const successStep = runner.planStep(step, after, state.currentAction!, state.currentAction!, runner.boundCondition(step.postconditions[0] ?? { type: 'no_console_errors' }, after), state.lastValidation!, state.lastQuiescence);
    return { evaluations: evals, lastValidation: business, steps: [successStep] };
  };

  const repeatUntilNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    if (!step.repeatUntil) return { repeatStep: false };
    const after = state.after!;
    const repeated = await runner.checkAll([step.repeatUntil], after, state.beforeState, state.afterState);
    if (!repeated.ok) {
      const prevIter = state.iterations[step.id] ?? 1;
      const iteration = prevIter + 1;
      if (iteration > (step.maxIterations ?? 10)) {
        const lastStep = [...state.steps].at(-1)!;
        return { ok: false, failedStep: lastStep, failedObservation: after, failedMessage: `repeatUntil exhausted after ${iteration - 1} iterations`, done: true };
      }
      return { iterations: { [step.id]: iteration }, repeatStep: true };
    }
    return { repeatStep: false };
  };

  const replanNode = async (state: State): Promise<Partial<State>> => {
    const step = state.currentPlan.steps[state.stepIndex]!;
    const snap = makeResultView(state);
    const replanReason = state.lastValidation?.ok === false ? 'ASSERTION_FAILED' : 'PRECONDITION_FAILED';
    const message = state.lastValidation?.actual ?? state.failedMessage ?? 'replan triggered';
    const patched = await runner.tryReplan({ result: snap, config: state.config, currentPlan: state.currentPlan, step, before: state.before!, reason: replanReason, message, replans: state.replans });
    const diff = diffResult(makeResultView(state), snap);
    if (patched) return { ...diff, currentPlan: patched, replans: state.replans + 1, patchedStep: true, passed: true };
    const lastStep = [...state.steps].at(-1);
    return { ...diff, ok: false, failedStep: lastStep, failedObservation: state.before, failedMessage: message, done: true };
  };

  const advanceNode = (state: State): Partial<State> => {
    if (state.patchedStep || state.repeatStep) return { patchedStep: false, repeatStep: false, passed: false };
    return { stepIndex: state.stepIndex + 1, passed: false };
  };

  const finalAssertionsNode = async (state: State): Promise<Partial<State>> => {
    const plan = state.currentPlan;
    const finalObs = await runner.browser.observe();
    runner.locators.rebuild(finalObs);
    const finalState = await runner.runtimeState(finalObs, plan.assertions);
    const finalAssertions = await runner.checkAll(plan.assertions, finalObs, finalState, finalState);
    if (!finalAssertions.ok) {
      const action = runner.waitAction('final business assertion failed');
      const fakeStep = { id: 'PLAN_ASSERTIONS', description: 'Final business assertions', preconditions: [], action: { type: 'waitForStable', reason: 'final business assertion check' }, postconditions: plan.assertions, assertions: [], onFailure: 'BLOCK' } as unknown as ExecutionStep;
      const qaStep = runner.planStep(fakeStep, finalObs, action, action, runner.boundCondition(plan.assertions[0] ?? { type: 'no_console_errors' }, finalObs), finalAssertions, undefined, 'business assertion failed');
      return { ok: false, failedStep: qaStep, failedObservation: finalObs, failedMessage: finalAssertions.actual ?? 'business assertion failed', steps: [qaStep] };
    }
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Build graph via chained addNode (required for TypeScript node-name inference)
  // ---------------------------------------------------------------------------

  const compiled = new StateGraph(PlanExecutionState)
    .addNode('observe', observeNode)
    .addNode('precheck', precheckNode)
    .addNode('resolveAction', resolveActionNode)
    .addNode('policyGuard', policyGuardNode)
    .addNode('destructiveGuard', destructiveGuardNode)
    .addNode('execute', executeNode)
    .addNode('observeAfter', observeAfterNode)
    .addNode('postcheck', postcheckNode)
    .addNode('assertions', assertionsNode)
    .addNode('repeatUntil', repeatUntilNode)
    .addNode('replan', replanNode)
    .addNode('advance', advanceNode)
    .addNode('finalAssertions', finalAssertionsNode)
    .addEdge(START, 'observe')
    .addEdge('observe', 'precheck')
    .addConditionalEdges('precheck', (state: State) => {
      const step = state.currentPlan.steps[state.stepIndex]!;
      const pre = state.lastValidation!;
      if (pre.ok) return 'resolveAction';
      if (step.onFailure === 'CONTINUE_WITH_WARNING') return 'advance';
      return 'replan';
    })
    .addConditionalEdges('resolveAction', (state: State) => {
      if (state.done) return END;
      if (!state.currentAction) return 'replan';
      return 'policyGuard';
    })
    .addConditionalEdges('policyGuard', (state: State) => {
      if (state.done) return END;
      return 'destructiveGuard';
    })
    .addConditionalEdges('destructiveGuard', (state: State) => {
      if (state.done) return END;
      return 'execute';
    })
    .addEdge('execute', 'observeAfter')
    .addEdge('observeAfter', 'postcheck')
    .addConditionalEdges('postcheck', (state: State) => {
      const validation = state.lastValidation!;
      if (state.passed) return 'advance';
      if (!validation.ok) return 'replan';
      return 'assertions';
    })
    .addConditionalEdges('assertions', (state: State) => {
      const validation = state.lastValidation!;
      if (!validation.ok) return 'replan';
      return 'repeatUntil';
    })
    .addConditionalEdges('repeatUntil', (state: State) => {
      if (state.done) return END;
      if (state.repeatStep) return 'observe';
      return 'advance';
    })
    .addConditionalEdges('replan', (state: State) => {
      if (state.done) return END;
      if (state.patchedStep) return 'observe';
      return END;
    })
    .addConditionalEdges('advance', (state: State) => {
      if (state.stepIndex >= state.currentPlan.steps.length) return 'finalAssertions';
      return 'observe';
    })
    .addEdge('finalAssertions', END)
    .compile({ checkpointer: new MemorySaver() });

  return compiled as CompiledGraph;
}

// ---------------------------------------------------------------------------
// Convert final graph state to PlanExecutionResult
// ---------------------------------------------------------------------------

export function stateToResult(state: PlanExecutionGraphState, plan: ExecutionPlan): PlanExecutionResult {
  return {
    ok: state.ok ?? true,
    steps: state.steps ?? [],
    attempts: state.attempts ?? [],
    warnings: state.warnings ?? [],
    finalPlan: state.currentPlan ?? plan,
    patchHistory: state.patchHistory ?? [],
    evaluations: state.evaluations ?? [],
    locatorTelemetry: state.locatorTelemetry ?? [],
    failedStep: state.failedStep,
    failedObservation: state.failedObservation,
    failedMessage: state.failedMessage,
  };
}

export type PlanExecutionGraphState = typeof PlanExecutionState.State;
