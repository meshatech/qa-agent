import { describe, expect, it, vi } from 'vitest';
import { Command } from '@langchain/langgraph';
import { PlanGraphExecutorService } from '../src/application/services/plan-graph-executor.service.js';
import { buildPlanExecutionGraph, stateToResult } from '../src/infra/graph/plan-execution.graph.js';
import { PlanStepRunnerService } from '../src/application/services/plan-step-runner.service.js';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { DataHarnessService } from '../src/application/services/data-harness.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { RecoveryPolicyService } from '../src/application/services/recovery-policy.service.js';
import { TaskMemoryService } from '../src/application/services/task-memory.service.js';
import { PlanReplannerService } from '../src/application/services/plan-replanner.service.js';
import { ElementAvailabilityResolver } from '../src/application/services/element-availability-resolver.service.js';
import { NetworkStateValidatorService } from '../src/application/services/network-state-validator.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { DestructiveActionApproverPort } from '../src/application/ports/destructive-action-approver.port.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import type { ExecutionPlan } from '../src/domain/schemas/execution-plan.schema.js';
import type { QaAction } from '../src/domain/schemas/action.schema.js';

const obs = (texts: string[], value = ''): ScreenObservation => ({
  observationId: `obs-${texts.join('-')}-${value}`,
  createdAt: new Date().toISOString(),
  url: 'https://app.local/',
  title: 'App',
  visibleTexts: texts,
  elements: [
    { id: 'el_001', role: 'button', name: 'Salvar', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Salvar' } },
    { id: 'el_002', role: 'textbox', name: 'Nome', value, inViewport: true, locator: { strategy: 'label', text: 'Nome' } },
  ],
  pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
  consoleSignals: [],
  networkSignals: [],
  meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
});

const config = RunConfigSchema.parse({ baseUrl: 'https://app.local', appDomains: ['app.local'], demand: { id: 'D', title: 'T', description: 'D' } });

const fakeDecision = {
  async decide() {
    return {
      action: { type: 'waitForStable', reason: 'fallback' },
      expected_after_action: { type: 'no_console_errors' },
      fallback_action: { type: 'waitForStable', reason: 'fallback' },
      confidence: 0.5,
      thought_summary: 'fallback',
      observationId: 'obs_1',
      schemaVersion: 'action.v1',
    } as import('../src/domain/schemas/action.schema.js').QaActionEnvelope;
  },
} as unknown as DecisionProviderPort;

const fakeNetworkValidator = { validate() { return undefined; } } as unknown as NetworkStateValidatorService;
const allowApprover: DestructiveActionApproverPort = { async approve() { return true; } };

function makeRunner(browser: BrowserHarnessPort, replanner?: PlanReplannerService, decision?: DecisionProviderPort): PlanStepRunnerService {
  const locators = new LocatorResolverService();
  const recovery = new RecoveryPolicyService(browser);
  const rep = replanner ?? ({ replan: async () => { throw new Error('no replanner in unit test'); } } as unknown as PlanReplannerService);
  return new PlanStepRunnerService(
    browser, locators, new DataHarnessService(), new ActionPolicyService(),
    new ElementAvailabilityResolver(browser, locators), recovery, new TaskMemoryService(),
    rep, decision ?? fakeDecision, fakeNetworkValidator,
  );
}

function makeExecutor(browser: BrowserHarnessPort, opts: {
  replanner?: PlanReplannerService;
  decision?: DecisionProviderPort;
  approver?: DestructiveActionApproverPort;
} = {}): PlanGraphExecutorService {
  const runner = makeRunner(browser, opts.replanner, opts.decision);
  return new PlanGraphExecutorService(runner, opts.approver ?? allowApprover);
}

describe('PlanGraphExecutorService', () => {
  it('executes a linear plan successfully', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Dashboard']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'linear', version: 1, goal: 'Linear', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Click save', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'save' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.stepId).toBe('S001');
  });

  it('repeats a guarded step until repeatUntil passes', async () => {
    let clicks = 0;
    let current = obs(['Pendente']);
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return current; },
      async execute(action) {
        if (action.type === 'click') {
          clicks++;
          current = obs([clicks >= 2 ? 'Concluído' : 'Pendente']);
        }
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        if (expected.type === 'text_visible') return { ok: current.visibleTexts.includes(expected.text), type: expected.type, durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'repeat', version: 1, goal: 'Repeat', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Process item', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'process' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK', repeatUntil: { type: 'text_visible', text: 'Concluído' }, maxIterations: 3 }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(clicks).toBe(2);
  });

  it('replans a failed precondition and retries the patched step', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Menu']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        if (expected.type === 'text_visible') return { ok: expected.text === 'Menu', type: expected.type, durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'replan', version: 1, goal: 'Replan', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Wait for missing screen', preconditions: [{ type: 'text_visible', text: 'Missing' }], action: { type: 'waitForStable', reason: 'wait' }, postconditions: [{ type: 'text_visible', text: 'Menu' }], assertions: [], onFailure: 'ASK_LLM_TO_REPLAN' }],
    };
    const patchedPlan: ExecutionPlan = {
      ...plan, version: 2,
      steps: [{ ...plan.steps[0]!, preconditions: [], description: 'Patched wait' }],
    };
    const replanner = {
      async replan() {
        return {
          plan: patchedPlan,
          history: {
            basePlanId: 'replan', basePlanVersion: 1, operation: 'replace_step', stepId: 'S001',
            reason: 'remove stale precondition', replanReason: 'PRECONDITION_FAILED', appliedPlanVersion: 2,
            status: 'APPLIED',
            patch: { basePlanId: 'replan', basePlanVersion: 1, operation: 'replace_step', stepId: 'S001', reason: 'remove stale precondition', replanReason: 'PRECONDITION_FAILED', steps: patchedPlan.steps },
          },
        };
      },
    } as unknown as PlanReplannerService;

    const result = await makeExecutor(browser as BrowserHarnessPort, { replanner }).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(result.finalPlan.version).toBe(2);
    expect(result.patchHistory).toHaveLength(1);
  });

  it('uses LLM fallback when locator cannot be resolved', async () => {
    const noMatchObs: ScreenObservation = {
      observationId: 'obs-no-match',
      createdAt: new Date().toISOString(),
      url: 'https://app.local/',
      title: 'App',
      visibleTexts: ['Fallback target'],
      elements: [
        { id: 'el_001', role: 'button', name: 'Salvar', inViewport: false, locator: { strategy: 'role', role: 'button', name: 'Salvar' } },
      ],
      pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
      consoleSignals: [],
      networkSignals: [],
      meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    };
    const actions: QaAction[] = [];
    const decide = vi.fn(async () => ({
      schemaVersion: 'action.v1' as const,
      observationId: noMatchObs.observationId,
      thought_summary: 'fallback resolved target',
      action: { type: 'click' as const, targetElementId: 'el_001', reason: 'fallback click' },
      expected_after_action: { type: 'no_console_errors' as const },
      fallback_action: { type: 'press' as const, key: 'Escape' as const, reason: 'close transient UI' },
      confidence: 0.8,
    }));
    const decision = { decide } as unknown as DecisionProviderPort;
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return noMatchObs; },
      async execute(action) {
        actions.push(action);
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'llm-fallback', version: 1, goal: 'LLM fallback', mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Use missing locator', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Missing' }, reason: 'click missing' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort, { decision }).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(decide).toHaveBeenCalledOnce();
    expect(actions[0]).toEqual({ type: 'click', targetElementId: 'el_001', reason: 'fallback click' });
    expect(result.locatorTelemetry.some((e) => e.type === 'llm_decide')).toBe(true);
  });

  it('fails with RECOVERY_EXHAUSTED when postcondition fails and recovery cannot restore it', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Working']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        // Postcondition text 'Done' is never visible → both the initial check and
        // every recovery fallback validation fail → recovery exhausts.
        if (expected.type === 'text_visible') return { ok: false, type: expected.type, expected: expected.text, actual: 'Working', durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'recovery', version: 1, goal: 'Recovery', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Click save', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'save' }, postconditions: [{ type: 'text_visible', text: 'Done' }], assertions: [], onFailure: 'BLOCK' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(false);
    expect(result.steps.some((s) => s.error?.code === 'RECOVERY_EXHAUSTED')).toBe(true);
    // Recovery actually attempted fallback actions before giving up.
    expect(result.attempts.some((a) => ['press', 'clickOutside', 'waitForStable'].includes(a.actionType))).toBe(true);
  });

  it('fails final business assertions after all steps pass', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Produto salvo']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        // Step postcondition (no_console_errors) passes, but the plan-level
        // assertion text 'Faturado' is never present.
        if (expected.type === 'text_visible') return { ok: expected.text !== 'Faturado', type: expected.type, expected: expected.text, actual: 'Produto salvo', durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'final-assert', version: 1, goal: 'Final assertions', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [{ type: 'text_visible', text: 'Faturado' }],
      steps: [{ id: 'S001', description: 'Wait', preconditions: [], action: { type: 'waitForStable', reason: 'wait' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(false);
    expect(result.failedStep?.stepId).toBe('PLAN_ASSERTIONS');
  });

  it('blocks at the policy guard before reaching the destructive guard or execute', async () => {
    let executeCalls = 0;
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Canvas']); },
      async execute(action) { executeCalls++; return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    // clickAtCoordinates without 3 prior semantic failures is rejected by the
    // ActionPolicyService — a NON-destructive policy violation. It must short-circuit
    // at policyGuard and never reach destructiveGuard/execute.
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'policy-block', version: 1, goal: 'Policy block', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Tap pixel', preconditions: [], action: { type: 'clickAtCoordinates', x: 10, y: 20, reason: 'tap raw coordinates', risk: 'HIGH' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(false);
    expect(result.failedMessage).toMatch(/clickAtCoordinates/);
    expect(executeCalls).toBe(0);
  });

  it('fails when maxReplans is exhausted', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['OtherPage']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        if (expected.type === 'text_visible') return { ok: false, type: expected.type, expected: expected.text, actual: 'OtherPage', durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'no-replan', version: 1, goal: 'Exhaust', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [{ id: 'S001', description: 'Wait for screen', preconditions: [{ type: 'text_visible', text: 'ExpectedPage' }], action: { type: 'waitForStable', reason: 'wait' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'ASK_LLM_TO_REPLAN' }],
    };

    const result = await makeExecutor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(false);
    expect(result.finalPlan.version).toBe(1);
  });
});

describe('HITL (buildPlanExecutionGraph — destructive action interrupt)', () => {
  const destructiveConfig = RunConfigSchema.parse({
    baseUrl: 'https://app.local',
    appDomains: ['app.local'],
    demand: { id: 'D', title: 'T', description: 'D' },
    runtime: { destructiveActionPolicy: 'ASK_APPROVAL' },
  });

  const destructivePlan: ExecutionPlan = {
    schemaVersion: 'execution-plan.v1', planId: 'hitl', version: 1, goal: 'HITL', mode: 'HYBRID_GUARDED',
    runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'ASK_APPROVAL' }, assertions: [],
    steps: [{
      id: 'S001',
      description: 'Excluir produto',
      preconditions: [],
      action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'excluir produto da lista' },
      postconditions: [{ type: 'no_console_errors' }],
      assertions: [],
      onFailure: 'BLOCK',
    }],
  };

  const simpleBrowser: Partial<BrowserHarnessPort> = {
    async observe() { return obs(['Dashboard']); },
    async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
    async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
    async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
  };

  const initialInput = {
    currentPlan: destructivePlan,
    stepIndex: 0, attempt: 0, replans: 0, iterations: {},
    passed: false, patchedStep: false, repeatStep: false, done: false, ok: true,
    config: destructiveConfig,
  };

  it('pauses on interrupt and exposes payload for external approver to reject', async () => {
    const blockApprover: DestructiveActionApproverPort = { async approve() { return false; } };
    const runner = makeRunner(simpleBrowser as BrowserHarnessPort);
    const graph = buildPlanExecutionGraph(runner, blockApprover);
    const thread = { configurable: { thread_id: `hitl-block-${Date.now()}` } };

    const interrupted = await graph.invoke(initialInput, thread);

    expect(interrupted).toHaveProperty('__interrupt__');
    const interrupts = (interrupted as Record<string, unknown>).__interrupt__ as Array<{ value: { reason: string; policy: string; stepId: string } }>;
    expect(interrupts).toBeInstanceOf(Array);
    expect(interrupts[0]!.value.reason).toMatch(/excluir/i);
    expect(interrupts[0]!.value.policy).toBe('ASK_APPROVAL');
    // When the external executor (e.g. PlanGraphExecutorService) sees the
    // interrupt, it calls approver.approve(). If that returns false, the
    // executor returns a failure result WITHOUT resuming the graph.
  });

  it('continues execution when approver approves after interrupt', async () => {
    const approveAll: DestructiveActionApproverPort = { async approve() { return true; } };
    const runner = makeRunner(simpleBrowser as BrowserHarnessPort);
    const graph = buildPlanExecutionGraph(runner, approveAll);
    const thread = { configurable: { thread_id: `hitl-allow-${Date.now()}` } };

    const interrupted = await graph.invoke(initialInput, thread);

    expect(interrupted).toHaveProperty('__interrupt__');

    const finalState = await graph.invoke(new Command({ resume: true }), thread);

    const result = stateToResult(finalState, destructivePlan);
    expect(result.ok).toBe(true);
  });

  it('handles two sequential interrupts across distinct destructive steps', async () => {
    const twoDestructivePlan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'hitl-2', version: 1, goal: 'HITL x2', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'ASK_APPROVAL' }, assertions: [],
      steps: [
        { id: 'S001', description: 'Excluir item', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'excluir item da lista' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' },
        { id: 'S002', description: 'Confirmar pagamento', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'confirmar pagamento do pedido' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' },
      ],
    };
    const approveAll: DestructiveActionApproverPort = { async approve() { return true; } };
    const runner = makeRunner(simpleBrowser as BrowserHarnessPort);
    const graph = buildPlanExecutionGraph(runner, approveAll);
    const thread = { configurable: { thread_id: `hitl-seq-${Date.now()}` } };

    // First step's destructive guard pauses.
    const first = await graph.invoke({ ...initialInput, currentPlan: twoDestructivePlan }, thread);
    expect(first).toHaveProperty('__interrupt__');

    // Resuming runs step 1 to completion, advances, and pauses again at step 2.
    const second = await graph.invoke(new Command({ resume: true }), thread);
    expect(second).toHaveProperty('__interrupt__');

    // Final resume completes the whole plan.
    const finalState = await graph.invoke(new Command({ resume: true }), thread);
    const result = stateToResult(finalState, twoDestructivePlan);
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(2);
  });
});
