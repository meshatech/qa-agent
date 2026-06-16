import { describe, expect, it, vi } from 'vitest';
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
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';
import type { ExecutionStep, PlanCondition } from '../src/domain/schemas/execution-plan.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D', title: 'T', description: 'D' },
  runtime: {
    elementAvailability: {
      enabled: true,
      maxOpenAttempts: 3,
      allowClickOutside: true,
      allowGlobalEscape: true,
      allowedContainers: [],
    },
  },
});

function makeObs(overrides: Partial<ScreenObservation> = {}): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'https://app.local/',
    title: 'App',
    visibleTexts: ['Dashboard', 'Salvar'],
    elements: [
      { id: 'el_001', role: 'button', name: 'Salvar', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Salvar' } },
      { id: 'el_002', role: 'textbox', name: 'Nome', inViewport: true, locator: { strategy: 'label', text: 'Nome' } },
    ],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    ...overrides,
  };
}

function makeRunner(browser: Partial<BrowserHarnessPort>, decision?: DecisionProviderPort): PlanStepRunnerService {
  const b = browser as BrowserHarnessPort;
  const locators = new LocatorResolverService();
  return new PlanStepRunnerService(
    b,
    locators,
    new DataHarnessService(),
    new ActionPolicyService(),
    new ElementAvailabilityResolver(b, locators),
    new RecoveryPolicyService(b),
    new TaskMemoryService(),
    { replan: async () => { throw new Error('no replanner'); } } as unknown as PlanReplannerService,
    decision ?? { decide: async () => ({ action: { type: 'waitForStable', reason: 'fallback' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'waitForStable', reason: 'fallback' }, confidence: 0.5, thought_summary: 'fallback', observationId: 'obs_1', schemaVersion: 'action.v1' }) } as unknown as DecisionProviderPort,
    { validate: () => undefined } as unknown as NetworkStateValidatorService,
  );
}

function makeStep(action: ExecutionStep['action']): ExecutionStep {
  return { id: 'S001', scenarioId: 'SC001', taskId: 'T001', description: 'Test step', preconditions: [], action, postconditions: [], assertions: [], onFailure: 'BLOCK' };
}

describe('PlanStepRunnerService', () => {
  it('observes screen and rebuilds locators', async () => {
    const observation = makeObs();
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return observation; },
    };
    const runner = makeRunner(browser);

    const result = await runner.observe(makeStep({ type: 'waitForStable', reason: 'test' }));

    expect(result.observationId).toBe('obs_1');
  });

  it('checks all conditions and returns first failure', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async validate(expected) {
        if (expected.type === 'text_visible') return { ok: false, type: expected.type, expected: expected.text, actual: 'Missing', durationMs: 1 };
        return { ok: true, type: expected.type, durationMs: 1 };
      },
    };
    const runner = makeRunner(browser);
    const conditions: PlanCondition[] = [
      { type: 'text_visible', text: 'Missing' },
      { type: 'no_console_errors' },
    ];

    const result = await runner.checkAll(conditions, makeObs());

    expect(result.ok).toBe(false);
    expect(result.type).toBe('text_visible');
  });

  it('resolves action with deterministic locator', () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const runner = makeRunner(browser);
    const observation = makeObs();
    runner.locators.rebuild(observation);
    const step = makeStep({ type: 'click', target: { strategy: 'role', role: 'button', name: 'Salvar' }, reason: 'save' });
    const result: import('../src/application/services/plan-executor.service.js').PlanExecutionResult = {
      ok: true, steps: [], attempts: [], warnings: [], finalPlan: undefined as unknown as import('../src/domain/schemas/execution-plan.schema.js').ExecutionPlan,
      patchHistory: [], evaluations: [], locatorTelemetry: [],
    };

    const action = runner.resolveAction(step, observation, result);

    expect(action.type).toBe('click');
    expect((action as import('../src/domain/schemas/action.schema.js').QaAction & { targetElementId?: string }).targetElementId).toBe('el_001');
    expect(result.locatorTelemetry).toHaveLength(1);
    expect(result.locatorTelemetry[0]!.type).toBe('deterministic_resolution');
  });

  it('resolves action via LLM when locator not found', async () => {
    const decide = vi.fn().mockResolvedValue({
      schemaVersion: 'action.v1' as const,
      observationId: 'obs_1',
      thought_summary: 'llm fallback',
      action: { type: 'click' as const, targetElementId: 'el_001', reason: 'fallback' },
      expected_after_action: { type: 'no_console_errors' as const },
      fallback_action: { type: 'waitForStable' as const, reason: 'fallback' },
      confidence: 0.8,
    });
    const decision = { decide } as unknown as DecisionProviderPort;
    const browser: Partial<BrowserHarnessPort> = {
      async observe() { return makeObs({ elements: [] }); },
      async execute(action) { return { ok: true, actionType: action.type, durationMs: 1 }; },
      async waitForQuiescence() { return { stable: true, reason: 'NETWORK_AND_DOM_IDLE', elapsedMs: 1 }; },
      async validate() { return { ok: true, type: 'no_console_errors', durationMs: 1 }; },
    };
    const runner = makeRunner(browser, decision);
    const step = makeStep({ type: 'click', target: { strategy: 'role', role: 'button', name: 'Inexistente' }, reason: 'click' });

    const action = await runner.resolveViaLlm(step, makeObs({ elements: [] }), config);

    expect(decide).toHaveBeenCalledOnce();
    expect(action.type).toBe('click');
  });

  it('checks runtime conditions (auth_state)', () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const runner = makeRunner(browser);
    const condition: PlanCondition = { type: 'auth_state', expected: 'anonymous' };
    const obs = makeObs({ url: 'https://app.local/login' });
    const runtimeState: import('../src/domain/schemas/execution-plan.schema.js').RuntimeStateSnapshot = {
      observationId: obs.observationId,
      url: obs.url,
      semanticStates: { auth: 'anonymous' },
      attributes: {},
      storage: {},
      timestamp: new Date().toISOString(),
    };

    const result = runner.checkRuntimeCondition(condition, obs, runtimeState);

    expect(result).toBeDefined();
    expect(result!.ok).toBe(true);
    expect(result!.type).toBe('auth_state');
  });

  it('returns semantic states from observation', () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const runner = makeRunner(browser);
    const obs = makeObs({ url: 'https://app.local/login', visibleTexts: ['Entrar', 'Senha'] });

    const states = runner.semanticStates(obs);

    expect(states.auth).toBe('anonymous');
  });

  it('hasText finds text in visible elements', () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const runner = makeRunner(browser);
    const obs = makeObs();

    expect(runner.hasText(obs, 'Salvar')).toBe(true);
    expect(runner.hasText(obs, 'Inexistente')).toBe(false);
  });

  it('records accessibility warnings from audit', async () => {
    const browser: Partial<BrowserHarnessPort> = {
      async auditAccessibility() {
        return [
          { id: 'color-contrast', impact: 'serious', description: 'Low contrast', nodes: 3 },
          { id: 'aria-hidden-focus', impact: 'critical', description: 'Focusable aria-hidden', nodes: 1 },
        ];
      },
    };
    const runner = makeRunner(browser);
    const result: import('../src/application/services/plan-executor.service.js').PlanExecutionResult = {
      ok: true, steps: [], attempts: [], warnings: [], finalPlan: undefined as unknown as import('../src/domain/schemas/execution-plan.schema.js').ExecutionPlan,
      patchHistory: [], evaluations: [], locatorTelemetry: [],
    };

    await runner.recordAccessibilityWarnings(result, 'S001');

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.some((w) => w.message.includes('critical'))).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('serious'))).toBe(true);
  });

  it('conditionEvaluations returns single entry when no conditions', () => {
    const browser: Partial<BrowserHarnessPort> = {};
    const runner = makeRunner(browser);
    const result = runner.conditionEvaluations(
      makeStep({ type: 'waitForStable', reason: 'test' }),
      'precondition',
      [],
      { ok: true, type: 'conditions', durationMs: 0 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.conditionId).toBe('S001:precondition:none');
    expect(result[0]!.passed).toBe(true);
  });
});
