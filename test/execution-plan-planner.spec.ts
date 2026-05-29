import { describe, expect, it } from 'vitest';
import { ExecutionPlanPlannerService } from '../src/application/services/execution-plan-planner.service.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { QaScenario } from '../src/domain/models/run.model.js';

const config = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Abrir menu e sair' },
});

const authenticatedConfig = RunConfigSchema.parse({
  baseUrl: 'https://app.local',
  appDomains: ['app.local'],
  demand: { id: 'D1', title: 'Smoke', description: 'Abrir menu, alterar tema e sair' },
  auth: { kind: 'storageState', path: '.auth/state.json' },
});

const scenarios: QaScenario[] = [{
  id: 'scenario-001',
  title: 'Smoke',
  status: 'PLANNED',
  intent: 'POSITIVE',
  tasks: [{ id: 'T001', title: 'Verificar menu', expected: 'Menu visível', status: 'PENDING', intent: 'POSITIVE' }],
}];

describe('ExecutionPlanPlannerService', () => {
  it('uses a valid LLM ExecutionPlan', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'llm-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            scenarioId: 'scenario-001',
            taskId: 'T001',
            description: 'Open menu',
            preconditions: [],
            action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta' }, reason: 'open account menu' },
            postconditions: [{ type: 'ui_state', semanticKey: 'account_menu', expected: 'exists', source: 'dom' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('llm');
    expect(result.plan?.planId).toBe('llm-plan');
  });

  it('falls back when a click step has no state-changing postcondition', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'unsafe-click-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            scenarioId: 'scenario-001',
            taskId: 'T001',
            description: 'Open menu',
            preconditions: [],
            action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Conta' }, reason: 'open account menu' },
            postconditions: [{ type: 'text_visible', text: 'Sair' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('has no state-changing postcondition');
  });

  it('falls back to factory when LLM persists el_*', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          planId: 'bad-plan',
          goal: 'Bad',
          steps: [{ id: 'S001', description: 'Bad', action: { type: 'click', targetElementId: 'el_001', reason: 'bad' }, postconditions: [{ type: 'text_visible', text: 'Sair' }] }],
        } as never;
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('targetElementId');
    expect(result.plan?.planId).toBe('plan_D1');
  });

  it('falls back to factory when LLM tries to login after runtime auth', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'login-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            scenarioId: 'scenario-001',
            taskId: 'T001',
            description: 'Fill login form',
            preconditions: [],
            action: { type: 'navigate', to: 'https://app.local/login', reason: 'go to login page' },
            postconditions: [{ type: 'text_visible', text: 'Entrar' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(authenticatedConfig, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('auth is already handled');
  });

  it('falls back to factory when LLM tries to navigate to login after runtime auth', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'login-nav-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            scenarioId: 'scenario-001',
            taskId: 'T001',
            description: 'Navigate to login',
            preconditions: [],
            action: { type: 'navigate', to: 'https://app.local/login', reason: 'go to login page' },
            postconditions: [{ type: 'text_visible', text: 'Login' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(authenticatedConfig, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('auth is already handled');
  });

  it('does not reject generic words when they appear only in action reasons', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'reason-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            description: 'Toggle appearance',
            preconditions: [],
            action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Tema escuro' }, reason: 'change theme' },
            postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, []);

    expect(result.source).toBe('llm');
  });

  it('falls back when LLM steps do not preserve scenario catalog ids', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'missing-task-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            description: 'Check authenticated UI',
            preconditions: [],
            action: { type: 'waitForStable', reason: 'wait' },
            postconditions: [{ type: 'text_visible', text: 'Caixa de entrada' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('scenarioId/taskId');
  });

  it('falls back when a passive step expects runtime state changed', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'impossible-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'T001-auth',
            scenarioId: 'scenario-001',
            taskId: 'T001',
            description: 'Check authenticated UI',
            preconditions: [],
            action: { type: 'waitForStable', reason: 'wait' },
            postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'changed' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('cannot expect runtime state changed');
  });


  it('falls back to factory when appearance state uses a vague expected value', async () => {
    const provider: DecisionProviderPort = {
      async buildPlan() {
        return {
          schemaVersion: 'execution-plan.v1',
          planId: 'theme-plan',
          version: 1,
          goal: 'Smoke',
          mode: 'HYBRID_GUARDED',
          runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
          steps: [{
            id: 'S001',
            description: 'Toggle theme',
            preconditions: [],
            action: { type: 'click', target: { strategy: 'role', role: 'button', name: 'Tema' }, reason: 'toggle theme' },
            postconditions: [{ type: 'ui_state', semanticKey: 'appearance_mode', expected: 'default', source: 'dom' }],
            assertions: [],
            onFailure: 'RECOVER',
          }],
          assertions: [],
        };
      },
      async decide() { throw new Error('not used'); },
    };

    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const result = await new ExecutionPlanPlannerService(provider, new ExecutionPlanFactoryService(stubOutcomeResolver)).build(config, scenarios);

    expect(result.source).toBe('factory');
    expect(result.fallbackReason).toContain('appearance ui_state uses invalid expected value');
  });
});
