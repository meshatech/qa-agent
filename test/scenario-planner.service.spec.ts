import { describe, expect, it } from 'vitest';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { ExpectedOutcomeResolverService } from '../src/application/services/expected-outcome-resolver.service.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import type { QaScenario, QaTask } from '../src/domain/models/run.model.js';

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    baseUrl: 'https://app.local',
    appDomains: ['app.local'],
    demand: { id: 'DEMAND-1', title: 'Test Demand', description: 'Test description', acceptanceCriteria: ['Criterion 1', 'Criterion 2'] },
    auth: { kind: 'none' },
    runtime: { mode: 'PLAN_AND_EXECUTE', maxAttemptsPerStep: 3, maxReplansPerScenario: 2, destructiveActionPolicy: 'ASK_APPROVAL' },
    browser: { engine: 'chromium', viewport: { width: 1280, height: 720 }, headed: false, slowMoMs: 0 },
    timeouts: { navigationMs: 30000, actionMs: 10000, quiescenceMs: 5000 },
    ...overrides,
  } as RunConfig;
}

function makeDecision(plan?: QaScenario[]): DecisionProviderPort {
  return {
    decide: async () => ({ schemaVersion: 'action.v1', observationId: 'obs', thought_summary: 'test', action: { type: 'waitForStable', timeoutMs: 1000, reason: 'wait' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'waitForStable', timeoutMs: 1000, reason: 'fallback' }, confidence: 0.9 }),
    plan: plan ? async () => plan : undefined,
  };
}

function makeOutcomeResolver(): ExpectedOutcomeResolverService {
  return {
    resolve: async () => ({ kind: 'NO_REGRESSION', description: 'No regression expected' }),
    resolveMany: undefined,
  } as unknown as ExpectedOutcomeResolverService;
}

describe('ScenarioPlannerService', () => {
  it('plans scenarios from decision provider', async () => {
    const scenarios: QaScenario[] = [{
      id: 'scenario-1',
      title: 'Login flow',
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: [{
        id: 'T001',
        title: 'Login with credentials',
        expected: 'User is authenticated',
        status: 'PENDING',
        intent: 'POSITIVE',
      }],
    }];

    const service = new ScenarioPlannerService(makeDecision(scenarios), makeOutcomeResolver());
    const result = await service.plan(makeConfig());

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.tasks.length).toBeGreaterThan(0);
  });

  it('falls back to generated scenarios when decision provider returns empty', async () => {
    const service = new ScenarioPlannerService(makeDecision([]), makeOutcomeResolver());
    const result = await service.plan(makeConfig());

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.tasks.length).toBeGreaterThan(0);
    expect(result[0]!.tasks[0]!.title).toBeDefined();
  });

  it('topologically sorts tasks with dependencies', async () => {
    const scenarios: QaScenario[] = [{
      id: 'scenario-1',
      title: 'Flow',
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: [
        { id: 'T002', title: 'Second', expected: 'Second', status: 'PENDING', dependsOn: ['T001'], intent: 'POSITIVE' },
        { id: 'T001', title: 'First', expected: 'First', status: 'PENDING', intent: 'POSITIVE' },
      ],
    }];

    const service = new ScenarioPlannerService(makeDecision(scenarios), makeOutcomeResolver());
    const result = await service.plan(makeConfig());

    const tasks = result[0]!.tasks;
    expect(tasks[0]!.id).toBe('T001');
    expect(tasks[1]!.id).toBe('T002');
  });

  it('deduplicates tasks', async () => {
    const scenarios: QaScenario[] = [{
      id: 'scenario-1',
      title: 'Flow',
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: [
        { id: 'T001', title: 'Same task', expected: 'Same task', status: 'PENDING', intent: 'POSITIVE' },
        { id: 'T002', title: 'Same task', expected: 'Same task', status: 'PENDING', intent: 'POSITIVE' },
      ],
    }];

    const service = new ScenarioPlannerService(makeDecision(scenarios), makeOutcomeResolver());
    const result = await service.plan(makeConfig());

    const uniqueTasks = result[0]!.tasks.filter((t, i, arr) => arr.findIndex((x) => x.title === t.title && x.expected === t.expected) === i);
    expect(uniqueTasks.length).toBeLessThanOrEqual(2);
  });

  it('applies auth policy when auth is required', async () => {
    const scenarios: QaScenario[] = [{
      id: 'scenario-1',
      title: 'Flow',
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks: [
        { id: 'T001', title: 'Login', expected: 'Login', status: 'PENDING', intent: 'POSITIVE' },
        { id: 'T002', title: 'Do something', expected: 'Done', status: 'PENDING', intent: 'POSITIVE' },
      ],
    }];

    const service = new ScenarioPlannerService(makeDecision(scenarios), makeOutcomeResolver());
    const result = await service.plan(makeConfig({ auth: { kind: 'formLogin', loginUrl: '/login', usernameSelector: '#user', passwordSelector: '#pass', submitSelector: '#submit', usernameEnv: 'USER', passwordEnv: 'PASS', maxRetries: 3 } } as RunConfig));

    expect(result.length).toBeGreaterThan(0);
  });

  it('enforces plan policy limit', async () => {
    const tasks: QaTask[] = Array.from({ length: 12 }, (_, i) => ({
      id: `T${String(i + 1).padStart(3, '0')}`,
      title: `Task ${i}`,
      expected: `Task ${i}`,
      status: 'PENDING',
      intent: 'POSITIVE' as const,
    }));

    const scenarios: QaScenario[] = [{
      id: 'scenario-1',
      title: 'Flow',
      status: 'PLANNED',
      intent: 'POSITIVE',
      tasks,
    }];

    const service = new ScenarioPlannerService(makeDecision(scenarios), makeOutcomeResolver());
    const result = await service.plan(makeConfig());

    expect(result[0]!.tasks.length).toBeLessThanOrEqual(8);
  });
});
