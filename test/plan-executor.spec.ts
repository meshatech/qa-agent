import { describe, expect, it, vi } from 'vitest';
import { PlanExecutorService } from '../src/application/services/plan-executor.service.js';
import { LocatorResolverService } from '../src/application/services/locator-resolver.service.js';
import { DataHarnessService } from '../src/application/services/data-harness.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { RecoveryPolicyService } from '../src/application/services/recovery-policy.service.js';
import { TaskMemoryService } from '../src/application/services/task-memory.service.js';
import { PlanReplannerService } from '../src/application/services/plan-replanner.service.js';
import { ElementAvailabilityResolver } from '../src/application/services/element-availability-resolver.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { BrowserHarnessPort } from '../src/application/ports/browser-harness.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import type { ExecutionPlan } from '../src/domain/schemas/execution-plan.schema.js';
import type { QaAction } from '../src/domain/schemas/action.schema.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';

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

const fakeDecision = { async decide() { return { action: { type: 'waitForStable', reason: 'fallback' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'waitForStable', reason: 'fallback' }, confidence: 0.5, thought_summary: 'fallback', observationId: 'obs_1', schemaVersion: 'action.v1' } as import('../src/domain/schemas/action.schema.js').QaActionEnvelope; } } as unknown as import('../src/application/ports/decision-provider.port.js').DecisionProviderPort;

function executor(browser: BrowserHarnessPort): PlanExecutorService {
  const recovery = new RecoveryPolicyService(browser);
  const replanner = { replan: async () => { throw new Error('no replanner in unit test'); } } as unknown as PlanReplannerService;
  const locators = new LocatorResolverService();
  return new PlanExecutorService(browser, locators, new DataHarnessService(), new ActionPolicyService(), new ElementAvailabilityResolver(browser, locators), recovery, new TaskMemoryService(), replanner, fakeDecision);
}

function executorWithReplanner(browser: BrowserHarnessPort, replanner: PlanReplannerService): PlanExecutorService {
  const recovery = new RecoveryPolicyService(browser);
  const locators = new LocatorResolverService();
  return new PlanExecutorService(browser, locators, new DataHarnessService(), new ActionPolicyService(), new ElementAvailabilityResolver(browser, locators), recovery, new TaskMemoryService(), replanner, fakeDecision);
}

function executorWithDecision(browser: BrowserHarnessPort, decision: DecisionProviderPort): PlanExecutorService {
  const recovery = new RecoveryPolicyService(browser);
  const replanner = { replan: async () => { throw new Error('no replanner in unit test'); } } as unknown as PlanReplannerService;
  const locators = new LocatorResolverService();
  return new PlanExecutorService(browser, locators, new DataHarnessService(), new ActionPolicyService(), new ElementAvailabilityResolver(browser, locators), recovery, new TaskMemoryService(), replanner, decision);
}

describe('PlanExecutorService', () => {
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
      steps: [{ id: 'S001', description: 'Process item', preconditions: [], action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'process item' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK', repeatUntil: { type: 'text_visible', text: 'Concluído' }, maxIterations: 2 }],
    };
    expect((await executor(browser as BrowserHarnessPort).execute(plan, config)).ok).toBe(true);
    expect(clicks).toBe(2);
  });

  it('stores extracted screen data for subsequent guarded actions', async () => {
    let filled = '';
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Preço']); },
      async execute(action) {
        if (action.type === 'extract') return { ok: true, actionType: action.type, durationMs: 1, data: 'R$ 10,00' };
        if (action.type === 'fill') filled = action.value;
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) { return { ok: true, type: expected.type, durationMs: 1 }; },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1', planId: 'extract', version: 1, goal: 'Extract', mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [],
      steps: [
        { id: 'S001', description: 'Read value', preconditions: [], action: { type: 'extract', target: { strategy: 'label', text: 'Nome' }, key: 'price', source: 'text', reason: 'extract value' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' },
        { id: 'S002', description: 'Reuse value', preconditions: [], action: { type: 'fill', target: { strategy: 'label', text: 'Nome' }, value: '{{ref:price}}', reason: 'reuse extracted value' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'BLOCK' },
      ],
    };
    expect((await executor(browser as BrowserHarnessPort).execute(plan, config)).ok).toBe(true);
    expect(filled).toBe('R$ 10,00');
  });

  it('executes a manual plan without LLM and reuses dynamic data in postconditions', async () => {
    let current = obs(['Novo produto']);
    const actions: QaAction[] = [];
    const browser: Partial<BrowserHarnessPort> = {
      async observe() {
        return current;
      },
      async execute(action) {
        actions.push(action);
        if (action.type === 'fill') current = obs(['Novo produto'], action.value);
        if (action.type === 'click') current = obs(['Produto salvo'], current.elements[1]?.value);
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() {
        return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 };
      },
      async validate(expected) {
        if (expected.type === 'field_value_contains') return { ok: current.elements.some((e) => e.value?.includes(expected.value)), type: expected.type, durationMs: 1 };
        if (expected.type === 'text_visible') return { ok: current.visibleTexts.some((text) => text.includes(expected.text)), type: expected.type, durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'manual',
      version: 1,
      goal: 'Manual',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{
        id: 'S001',
        description: 'Fill name',
        preconditions: [{ type: 'element_visible', target: { strategy: 'label', text: 'Nome' } }],
        action: { type: 'fill', target: { strategy: 'label', text: 'Nome' }, value: '{{uniqueName:productName:Produto}}', reason: 'fill product name' },
        postconditions: [{ type: 'field_value_contains', target: { strategy: 'label', text: 'Nome' }, value: '{{ref:productName}}' }],
        assertions: [],
        onFailure: 'BLOCK',
      }],
    };

    const result = await executor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(actions[0]?.type).toBe('fill');
    expect(actions[0]).not.toHaveProperty('target');
    expect(actions[0]).toHaveProperty('targetElementId', 'el_002');
  });

  it('treats quiescence timeout as warning, not automatic bug', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Sair']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1500 }; },
      async waitForQuiescence() { return { stable: false, reason: 'TIMEOUT_BUT_CONTINUABLE', elapsedMs: 10 }; },
      async validate() { return { ok: true, type: 'text_visible', durationMs: 1 }; },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'manual',
      version: 1,
      goal: 'Manual',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{
        id: 'S001',
        description: 'Open menu',
        preconditions: [],
        action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'open menu' },
        postconditions: [{ type: 'text_visible', text: 'Sair' }],
        assertions: [],
        onFailure: 'BLOCK',
      }],
    };

    const result = await executor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.message)).toContain('QUIESCENCE_TIMEOUT');
  });

  it('records WCAG warnings from critical accessibility violations', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Dashboard']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) { return { ok: true, type: expected.type, durationMs: 1 }; },
      async auditAccessibility() {
        return [
          { id: 'color-contrast', impact: 'critical', description: 'Insufficient color contrast', nodes: 2 },
          { id: 'landmark-one-main', impact: 'serious', description: 'Document should have one main landmark', nodes: 1 },
        ];
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'a11y-warning',
      version: 1,
      goal: 'Accessibility warning propagation',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{
        id: 'S001',
        description: 'Navigate to dashboard',
        preconditions: [],
        action: { type: 'navigate', to: 'https://app.local/dashboard', reason: 'open dashboard' },
        postconditions: [{ type: 'no_console_errors' }],
        assertions: [],
        onFailure: 'BLOCK',
      }],
    };

    const result = await executor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({ stepId: 'S001', message: 'WCAG_color-contrast [critical]: Insufficient color contrast' });
    expect(result.warnings).toContainEqual({ stepId: 'S001', message: 'WCAG_landmark-one-main [serious]: Document should have one main landmark' });
  });

  it('runs final business assertions after plan steps', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return obs(['Produto salvo']); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate(expected) {
        if (expected.type === 'text_visible') return { ok: expected.text === 'Produto salvo', type: expected.type, durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'manual',
      version: 1,
      goal: 'Manual',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [{ type: 'text_visible', text: 'Produto salvo' }],
      steps: [{
        id: 'S001',
        description: 'Wait',
        preconditions: [],
        action: { type: 'waitForStable', reason: 'wait' },
        postconditions: [{ type: 'text_visible', text: 'Produto salvo' }],
        assertions: [],
        onFailure: 'BLOCK',
      }],
    };

    const result = await executor(browser as BrowserHarnessPort).execute(plan, config);

    expect(result.ok).toBe(true);
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
      schemaVersion: 'execution-plan.v1',
      planId: 'manual',
      version: 1,
      goal: 'Manual',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{
        id: 'S001',
        description: 'Wait for missing screen',
        preconditions: [{ type: 'text_visible', text: 'Missing' }],
        action: { type: 'waitForStable', reason: 'wait' },
        postconditions: [{ type: 'text_visible', text: 'Menu' }],
        assertions: [],
        onFailure: 'ASK_LLM_TO_REPLAN',
      }],
    };
    const patchedPlan: ExecutionPlan = {
      ...plan,
      version: 2,
      steps: [{ ...plan.steps[0]!, preconditions: [], description: 'Patched wait' }],
    };
    const replanner = {
      async replan() {
        return {
          plan: patchedPlan,
          history: {
            basePlanId: 'manual',
            basePlanVersion: 1,
            operation: 'replace_step',
            stepId: 'S001',
            reason: 'remove stale precondition',
            replanReason: 'PRECONDITION_FAILED',
            appliedPlanVersion: 2,
            status: 'APPLIED',
            patch: {
              basePlanId: 'manual',
              basePlanVersion: 1,
              operation: 'replace_step',
              stepId: 'S001',
              reason: 'remove stale precondition',
              replanReason: 'PRECONDITION_FAILED',
              steps: patchedPlan.steps,
            },
          },
        };
      },
    } as unknown as PlanReplannerService;

    const result = await executorWithReplanner(browser as BrowserHarnessPort, replanner).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(result.finalPlan.version).toBe(2);
    expect(result.patchHistory).toHaveLength(1);
  });

  it('uses decision provider fallback when a locator cannot be resolved', async () => {
    let current = obs(['Fallback target']);
    const actions: QaAction[] = [];
    const decide = vi.fn(async () => ({
      schemaVersion: 'action.v1' as const,
      observationId: current.observationId,
      thought_summary: 'fallback resolved target',
      action: { type: 'click' as const, targetElementId: 'el_001', reason: 'fallback click' },
      expected_after_action: { type: 'no_console_errors' as const },
      fallback_action: { type: 'press' as const, key: 'Escape' as const, reason: 'close transient UI' },
      confidence: 0.8,
    }));
    const decision = { decide } as unknown as DecisionProviderPort;
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return current; },
      async execute(action) {
        actions.push(action);
        current = obs(['Fallback clicked']);
        return { ok: true, actionType: action.type, durationMs: 1 };
      },
      async waitForQuiescence() {
        return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 };
      },
      async validate() {
        return { ok: true, type: 'no_console_errors', durationMs: 1 };
      },
    };
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'manual',
      version: 1,
      goal: 'Fallback',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{
        id: 'S001',
        description: 'Use missing locator',
        preconditions: [],
        action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Missing' }, reason: 'click missing locator' },
        postconditions: [{ type: 'no_console_errors' }],
        assertions: [],
        onFailure: 'BLOCK',
      }],
    };

    const result = await executorWithDecision(browser as BrowserHarnessPort, decision).execute(plan, config);

    expect(result.ok).toBe(true);
    expect(decide).toHaveBeenCalledOnce();
    expect(actions[0]).toEqual({ type: 'click', targetElementId: 'el_001', reason: 'fallback click' });
  });
});
