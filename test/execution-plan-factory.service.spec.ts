import { describe, expect, it } from 'vitest';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
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
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    scenarioSelection: { maxScenarios: 5 },
    agentVersion: '0.1.0',
  };
}

function makeScenario(id: string, title: string, tasks: QaScenario['tasks']): QaScenario {
  return { id, title, tasks, status: 'PLANNED' };
}

describe('ExecutionPlanFactoryService', () => {
  const factory = new ExecutionPlanFactoryService();
  const config = makeConfig();

  it('generates plan for generic scenario with task', () => {
    const scenario = makeScenario('SCN-001', 'Login do usuario', [
      { id: 'T001', title: 'Preencher email e senha', expected: 'Usuario logado', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    expect(plan).toBeDefined();
    expect(plan!.steps.length).toBeGreaterThan(0);
    const parsed = ExecutionPlanSchema.safeParse(plan);
    if (!parsed.success) console.log(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.success).toBe(true);
  });

  it('generates navigate action when route is present in task', () => {
    const scenario = makeScenario('SCN-002', 'Acessar /profile', [
      { id: 'T002', title: 'Navegar para /profile', expected: 'Perfil carregado', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toContain('/profile');
  });

  it('generates navigate action for hyphenated routes', () => {
    const scenario = makeScenario('SCN-002B', 'Acessar /user-profile', [
      { id: 'T002B', title: 'Navegar para /user-profile', expected: 'Perfil carregado', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toContain('/user-profile');
  });

  it('generates click action with semantic locator for click task', () => {
    const scenario = makeScenario('SCN-003', 'Clicar botao salvar', [
      { id: 'T003', title: 'clicar no botao salvar', expected: 'Dados salvos', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('click');
    expect((step.action as { target: { strategy: string } }).target.strategy).toBe('semantic');
  });

  it('generates fill action with semantic locator for fill task', () => {
    const scenario = makeScenario('SCN-004', 'Preencher campo nome', [
      { id: 'T004', title: 'preencher campo nome', expected: 'Nome preenchido', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { target: { strategy: string } }).target.strategy).toBe('semantic');
  });

  it('preserves known flows: theme', () => {
    const scenario = makeScenario('SCN-005', 'Alterar tema', [
      { id: 'T005', title: 'Alterar tema do app', expected: 'Tema alterado', status: 'PENDING' },
    ]);
    const plan = factory.fromScenarios(config, [scenario]);

    expect(plan).toBeDefined();
    expect(plan!.steps.length).toBeGreaterThan(0);
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('returns undefined when no steps can be generated', () => {
    const scenario = makeScenario('SCN-006', 'Empty', []);
    const plan = factory.fromScenarios(config, [scenario]);

    expect(plan).toBeUndefined();
  });
});
