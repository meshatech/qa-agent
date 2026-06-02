import { describe, expect, it } from 'vitest';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import type { QaScenario, QaTask } from '../src/domain/models/run.model.js';
import type { ExpectedOutcome } from '../src/domain/schemas/expected-outcome.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(): RunConfig {
  return {
    baseUrl: 'http://localhost:3000',
    appDomains: ['localhost'],
    demand: { id: 'DEM-001', title: 'Test Demand', description: 'Test', acceptanceCriteria: [] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    evidence: { video: 'off', trace: 'off' },
    scenarioSelection: { maxScenarios: 5 },
    monitor: { enabled: false, stallThresholdMs: 30000, checkIntervalMs: 3000 },
    agentVersion: '0.1.0',
  };
}

function makeTask(id: string, title: string, expectedOutcome: ExpectedOutcome): QaTask {
  return { id, title, expected: title, status: 'PENDING', expectedOutcome };
}

function makeScenario(id: string, tasks: QaTask[]): QaScenario {
  return { id, title: id, tasks, status: 'PLANNED' };
}

describe('ExecutionPlanFactoryService — contract-driven (typed state, no words)', () => {
  const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
  const factory = new ExecutionPlanFactoryService(stubOutcomeResolver);
  const config = makeConfig();

  it('DEAUTHENTICATION proves logout via auth_state anonymous (not by words)', async () => {
    // Title is intentionally word-free for "logout" to prove the postcondition
    // comes from the typed contract, not from matching "Sair"/"logout".
    const scenario = makeScenario('SCN-001', [
      makeTask('T001', 'Encerrar acesso do usuario', { kind: 'DEAUTHENTICATION', description: 'usuario encerra o acesso' }),
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan!.steps).toHaveLength(1);
    const logoutStep = plan!.steps[0];
    expect(logoutStep.id).toBe('T001-logout');
    expect(logoutStep.postconditions).toEqual([{ type: 'auth_state', expected: 'anonymous' }]);
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('AUTHENTICATION proves login via auth_state authenticated', async () => {
    const scenario = makeScenario('SCN-002', [
      makeTask('T002', 'Entrar no sistema', { kind: 'AUTHENTICATION', description: 'usuario acessa area autenticada' }),
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan!.steps[0].postconditions).toEqual([{ type: 'auth_state', expected: 'authenticated' }]);
  });

  it('NAVIGATION builds navigate action + route_state matches', async () => {
    const scenario = makeScenario('SCN-003', [
      makeTask('T003', 'Ir para configuracoes', { kind: 'NAVIGATION', target: '/settings', description: 'acessar configuracoes' }),
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toBe('http://localhost:3000/settings');
    expect(step.postconditions).toEqual([{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'http://localhost:3000/settings' }]);
  });

  it('APPEARANCE_CHANGE proves appearance through typed ui_state without menu hardcode', async () => {
    const scenario = makeScenario('SCN-004', [
      makeTask('T004', 'Trocar modo visual', { kind: 'APPEARANCE_CHANGE', target: 'appearance_mode', description: 'alternar modo visual' }),
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan!.steps).toHaveLength(1);
    const themeStep = plan!.steps[0];
    expect(themeStep.postconditions).toEqual([
      { type: 'ui_state', semanticKey: 'appearance_mode', expected: 'exists', source: 'dom' },
    ]);
  });

  it('DISCLOSURE proves menu open via menu_state', async () => {
    const scenario = makeScenario('SCN-005', [
      makeTask('T005', 'Abrir painel', { kind: 'DISCLOSURE', target: 'account_menu', description: 'abrir painel de conta' }),
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan!.steps[0].postconditions).toEqual([
      { type: 'menu_state', semanticKey: 'account_menu', expected: 'open' },
    ]);
  });

  it('produces a schema-valid plan for every outcome kind', async () => {
    const kinds: ExpectedOutcome[] = [
      { kind: 'AUTHENTICATION', description: 'login' },
      { kind: 'DEAUTHENTICATION', description: 'logout' },
      { kind: 'NAVIGATION', target: '/x', description: 'nav' },
      { kind: 'APPEARANCE_CHANGE', description: 'theme' },
      { kind: 'DISCLOSURE', description: 'menu' },
      { kind: 'CONTENT_PRESENCE', target: 'Inbox', description: 'content' },
      { kind: 'DATA_ENTRY', description: 'fill' },
      { kind: 'NO_REGRESSION', description: 'safety' },
    ];
    const tasks = kinds.map((o, i) => makeTask(`T${i}`, `task ${i}`, o));
    const plan = await factory.fromScenarios(config, [makeScenario('SCN-ALL', tasks)]);

    expect(plan!.steps).toHaveLength(kinds.length);
    const parsed = ExecutionPlanSchema.safeParse(plan);
    if (!parsed.success) console.log(JSON.stringify(parsed.error.issues.slice(0, 8), null, 2));
    expect(parsed.success).toBe(true);
  });

  it('falls back to resolver when expectedOutcome is absent (no regex)', async () => {
    const scenario: QaScenario = {
      id: 'SCN-LEGACY',
      title: 'legacy',
      status: 'PLANNED',
      tasks: [{ id: 'T100', title: 'Sair da conta', expected: 'Logout concluído', status: 'PENDING' }],
    };
    const plan = await factory.fromScenarios(config, [scenario]);

    // Resolver returns NO_REGRESSION -> single generic step
    expect(plan!.steps[0].id).toBe('T100-outcome');
    expect(plan!.steps[0].action.type).toBe('waitForStable');
  });
});
