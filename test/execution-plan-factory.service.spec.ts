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
  const stubOutcomeResolver = {
    async resolve(_cfg: unknown, task: { title: string }) {
      const t = task.title.toLowerCase();
      if (t.includes('login') || t.includes('logar') || t.includes('entrar') || t.includes('auth')) return { kind: 'AUTHENTICATION' as const, description: 'login' };
      if (t.includes('logout') || t.includes('sair') || t.includes('sign out') || t.includes('deslogar')) return { kind: 'DEAUTHENTICATION' as const, description: 'logout' };
      if (t.includes('tema') || t.includes('theme') || t.includes('apar')) return { kind: 'APPEARANCE_CHANGE' as const, description: 'theme' };
      if (t.includes('menu') || t.includes('config') || t.includes('opções') || t.includes('conta')) return { kind: 'DISCLOSURE' as const, description: 'menu' };
      if (t.includes('navegar') || t.includes('navigate') || t.includes('acessar') || t.includes('access')) return { kind: 'NAVIGATION' as const, description: 'navigate' };
      if (t.includes('salvar') || t.includes('save') || t.includes('clicar') || t.includes('click')) return { kind: 'NO_REGRESSION' as const, description: 'click' };
      if (t.includes('preencher') || t.includes('fill') || t.includes('digitar') || t.includes('type')) return { kind: 'DATA_ENTRY' as const, description: 'fill' };
      return { kind: 'NO_REGRESSION' as const, description: 'safe' };
    },
  } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
  const factory = new ExecutionPlanFactoryService(stubOutcomeResolver);
  const config = makeConfig();

  it('generates plan for generic scenario with task', async () => {
    const scenario = makeScenario('SCN-001', 'Login do usuario', [
      { id: 'T001', title: 'Preencher email e senha', expected: 'Usuario logado', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan).toBeDefined();
    expect(plan!.steps.length).toBeGreaterThan(0);
    const parsed = ExecutionPlanSchema.safeParse(plan);
    if (!parsed.success) console.log(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.success).toBe(true);
  });

  it('generates navigate action when route is present in task', async () => {
    const scenario = makeScenario('SCN-002', 'Acessar /profile', [
      { id: 'T002', title: 'Navegar para /profile', expected: 'Perfil carregado', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toBe('http://localhost:3000');
  });

  it('generates navigate action for hyphenated routes', async () => {
    const scenario = makeScenario('SCN-002B', 'Acessar /user-profile', [
      { id: 'T002B', title: 'Navegar para /user-profile', expected: 'Perfil carregado', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toBe('http://localhost:3000');
  });

  it('generates waitForStable for generic click task without clear intent', async () => {
    const scenario = makeScenario('SCN-003', 'Clicar botao salvar', [
      { id: 'T003', title: 'clicar no botao salvar', expected: 'Dados salvos', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('waitForStable');
  });

  it('generates fill action for data entry task', async () => {
    const scenario = makeScenario('SCN-004', 'Preencher campo nome', [
      { id: 'T004', title: 'preencher campo nome', expected: 'Nome preenchido', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { target: { strategy: string } }).target.strategy).toBe('text_any');
  });

  it('preserves known flows: theme', async () => {
    const scenario = makeScenario('SCN-005', 'Alterar tema', [
      { id: 'T005', title: 'Alterar tema do app', expected: 'Tema alterado', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan).toBeDefined();
    expect(plan!.steps.length).toBeGreaterThan(0);
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('generates waitForStable for authenticated area task with auth_state postcondition', async () => {
    const scenario = makeScenario('SCN-007', 'Verificar área autenticada', [
      { id: 'T007', title: 'Verificar área autenticada', expected: 'Área visível', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('waitForStable');
    expect(step.postconditions).toEqual([
      { type: 'auth_state', expected: 'authenticated' },
    ]);
  });

  it('generates semantic click step for account menu task', async () => {
    const scenario = makeScenario('SCN-008', 'Abrir opções da conta', [
      { id: 'T008', title: 'Abrir opções da conta', expected: 'Menu visível', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'menu' } },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('click');
    expect((step.action as { target: { strategy: string } }).target.strategy).toBe('text_any');
    expect(step.postconditions).toEqual([
      { type: 'menu_state', expected: 'open', semanticKey: 'menu' },
    ]);
  });

  it('generates single step for logout task with multiple text alternatives', async () => {
    const scenario = makeScenario('SCN-009', 'Sair da conta', [
      { id: 'T009', title: 'Sair da conta', expected: 'Logout concluído', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan!.steps).toHaveLength(1);

    const logoutStep = plan!.steps[0];
    expect(logoutStep.id).toBe('T009-logout');
    expect(logoutStep.action.type).toBe('click');
    expect(logoutStep.preconditions).toEqual([]);
    expect((logoutStep.action as { target: { strategy: string; texts: string[] } }).target.strategy).toBe('text_any');
    expect((logoutStep.action as { target: { texts: string[] } }).target.texts).toContain('Sair');
    expect(logoutStep.postconditions).toEqual([
      { type: 'auth_state', expected: 'anonymous' },
    ]);
  });

  it('returns undefined when no steps can be generated', async () => {
    const scenario = makeScenario('SCN-006', 'Empty', []);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan).toBeUndefined();
  });
});
