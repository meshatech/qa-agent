import { describe, expect, it } from 'vitest';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import { ActionPolicyService } from '../src/application/services/action-policy.service.js';
import { ValueGeneratorService } from '../src/application/services/value-generator.service.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';
import { DEFAULT_TEST_MEMORY_CONFIG } from './helpers/memory-config.fixture.js';

function makeConfig(): RunConfig {
  return {
    baseUrl: 'http://localhost:3000',
    appDomains: ['localhost'],
    demand: { id: 'DEM-001', title: 'Test Demand', description: 'Test', acceptanceCriteria: [] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    evidence: { video: 'off', trace: 'off' },
    scenarioSelection: { maxScenarios: 5 },
    memory: DEFAULT_TEST_MEMORY_CONFIG,
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
  const factory = new ExecutionPlanFactoryService(stubOutcomeResolver, new ActionPolicyService(), new ValueGeneratorService());
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
    expect(step.isFallback).toBe(true);
  });

  it('generates fill action for data entry task', async () => {
    const scenario = makeScenario('SCN-004', 'Preencher campo nome', [
      { id: 'T004', title: 'preencher campo nome', expected: 'Nome preenchido', status: 'PENDING' },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { target: { strategy: string } }).target.strategy).toBe('semantic');
    expect(step.postconditions[0]).toMatchObject({ type: 'field_value_contains', value: 'safe-test-value' });
  });

  it('uses safe console check when data entry target resolves to NO_REGRESSION', async () => {
    const noTargetConfig: RunConfig = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: { DATA_ENTRY: ['NO_REGRESSION'] },
      },
    };
    const scenario = makeScenario('SCN-004B', 'Preencher campo desconhecido', [
      { id: 'T004B', title: 'preencher campo desconhecido', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'DATA_ENTRY', description: 'fill' } },
    ]);

    const plan = await factory.fromScenarios(noTargetConfig, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('waitForStable');
    expect(step.postconditions).toEqual([{ type: 'no_console_errors' }]);
    expect(step.isFallback).toBe(true);
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

  it('falls back to outcome text when semanticAliases is absent from runtime config', async () => {
    const configWithoutAliases = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: undefined,
      },
    } as unknown as RunConfig;
    const scenario = makeScenario('SCN-005B', 'Alterar aparência', [
      { id: 'T005B', title: 'Alterar aparência', expected: 'Aparência alterada', status: 'PENDING', expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'appearance control' } },
    ]);

    const plan = await factory.fromScenarios(configWithoutAliases, [scenario]);

    expect(plan).toBeDefined();
    const target = (plan!.steps[0]!.action as { target: { strategy: string; semanticKey: string; candidates: Array<{ strategy: string; text?: string; texts?: string[] }> } }).target;
    expect(target.strategy).toBe('semantic');
    expect(target.semanticKey).toBe('appearance_toggle');
    expect(target.candidates.some((c) => c.text === 'appearance control' || c.texts?.includes('appearance control'))).toBe(true);
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
      {
        type: 'text_any_visible',
        texts: ['menu', 'Perfil', 'Assinatura', 'Sair', 'Logout', 'Tema', 'Aparência'],
      },
    ]);
  });

  it('uses safe console check when disclosure target resolves to NO_REGRESSION', async () => {
    const noTargetConfig: RunConfig = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: { DISCLOSURE: ['NO_REGRESSION'] },
      },
    };
    const scenario = makeScenario('SCN-008B', 'Abrir painel desconhecido', [
      { id: 'T008B', title: 'Abrir painel desconhecido', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'menu' } },
    ]);

    const plan = await factory.fromScenarios(noTargetConfig, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('waitForStable');
    expect(step.postconditions).toEqual([{ type: 'no_console_errors' }]);
    expect(step.isFallback).toBe(true);
  });

  it('returns safe check step for classification failure outcome', async () => {
    const scenario = makeScenario('SCN-008C', 'Classificação falhou', [
      { id: 'T008C', title: 'Classificação falhou', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'CLASSIFICATION_FAILED', description: 'classification failed' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan).toBeDefined();
    expect(plan!.steps).toHaveLength(1);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect((plan!.steps[0].action as { reason: string }).reason).toContain('Classification failed');
    expect(plan!.steps[0].postconditions).toEqual([{ type: 'no_console_errors' }]);
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('uses safe console check for no regression outcome', async () => {
    const scenario = makeScenario('SCN-008D', 'Checagem segura', [
      { id: 'T008D', title: 'Checagem segura', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'NO_REGRESSION', description: 'safe check' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    const step = plan!.steps[0];
    expect(step.action.type).toBe('waitForStable');
    expect(step.postconditions).toEqual([{ type: 'no_console_errors' }]);
    expect(step.isFallback).toBe(true);
  });

  it('emits a safe check step when the only semantic target is destructive', async () => {
    const scenario = makeScenario('SCN-008E', 'Abrir alvo inseguro', [
      { id: 'T008E', title: 'Abrir alvo inseguro', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', target: 'Excluir conta', description: 'unsafe target' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('generates single step for logout task with multiple text alternatives', async () => {
    const logoutConfig: RunConfig = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: {
          DEAUTHENTICATION: ['Sair', 'Logout', 'Sign out'],
        },
      },
    };
    const scenario = makeScenario('SCN-009', 'Sair da conta', [
      { id: 'T009', title: 'Sair da conta', expected: 'Logout concluído', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
    ]);
    const plan = await factory.fromScenarios(logoutConfig, [scenario]);

    expect(plan!.steps).toHaveLength(1);

    const logoutStep = plan!.steps[0];
    expect(logoutStep.id).toBe('T009-logout');
    expect(logoutStep.action.type).toBe('click');
    expect(logoutStep.preconditions).toEqual([]);
    expect((logoutStep.action as { target: { strategy: string; semanticKey: string; candidates: Array<{ strategy: string; name?: string; text?: string }> } }).target.strategy).toBe('semantic');
    expect((logoutStep.action as { target: { semanticKey: string } }).target.semanticKey).toBe('logout_action');
    expect((logoutStep.action as { target: { candidates: Array<{ name?: string; text?: string }> } }).target.candidates.some((c) => c.name === 'Sair' || c.text === 'Sair')).toBe(true);
    expect(logoutStep.postconditions).toEqual([
      { type: 'auth_state', expected: 'anonymous' },
    ]);
  });

  it('emits safe check step for navigation target with path traversal', async () => {
    const scenario = makeScenario('SCN-010', 'Acessar perfil', [
      { id: 'T010', title: 'Navegar para perfil', expected: 'Perfil carregado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: '/../etc/passwd', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('emits safe check step for navigation target resolving to external host', async () => {
    const scenario = makeScenario('SCN-011', 'Acessar externo', [
      { id: 'T011', title: 'Navegar para externo', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: '//evil.com/admin', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('normalizes valid relative navigation target with new URL', async () => {
    const scenario = makeScenario('SCN-012', 'Acessar dashboard', [
      { id: 'T012', title: 'Navegar para dashboard', expected: 'Dashboard carregado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: '/dashboard', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    const step = plan!.steps[0];
    expect(step.action.type).toBe('navigate');
    expect((step.action as { to: string }).to).toBe('http://localhost:3000/dashboard');
  });

  it('filters unsafe candidates and keeps safe semantic targets', async () => {
    const unsafeConfig: RunConfig = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: { DISCLOSURE: ['Abrir', 'Excluir conta'] },
      },
    };
    const scenario = makeScenario('SCN-013', 'Abrir opções', [
      { id: 'T013', title: 'Abrir opções', expected: 'Opções visíveis', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'options' } },
    ]);

    const plan = await factory.fromScenarios(unsafeConfig, [scenario]);
    const step = plan!.steps[0];
    expect(step.action.type).toBe('click');
    expect((step.action as { target: { texts: string[] } }).target.texts).toEqual(['Abrir']);
  });

  it('returns safe check step for unwhitelisted outcome kind', async () => {
    const scenario = makeScenario('SCN-014', 'Outcome desconhecido', [
      { id: 'T014', title: 'Outcome desconhecido', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'CONTENT_PRESENCE', description: 'unknown' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan).toBeDefined();
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('emits safe check step for navigation target with javascript protocol', async () => {
    const scenario = makeScenario('SCN-015', 'Injeção JS', [
      { id: 'T015', title: 'Navegar para perfil', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: 'javascript:alert(1)', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('emits safe check step for navigation target with file protocol', async () => {
    const scenario = makeScenario('SCN-016', 'File access', [
      { id: 'T016', title: 'Acessar arquivo', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: 'file:///etc/passwd', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('generates email test value for data entry task with email keyword', async () => {
    const scenario = makeScenario('SCN-017', 'Preencher email', [
      { id: 'T017', title: 'preencher campo email', expected: 'Email preenchido', status: 'PENDING', expectedOutcome: { kind: 'DATA_ENTRY', description: 'fill email' } },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { value: string }).value).toBe('test@example.com');
  });

  it('generates password test value for data entry task with password keyword', async () => {
    const scenario = makeScenario('SCN-018', 'Preencher senha', [
      { id: 'T018', title: 'preencher campo senha', expected: 'Senha preenchida', status: 'PENDING', expectedOutcome: { kind: 'DATA_ENTRY', description: 'fill password' } },
    ]);
    const plan = await factory.fromScenarios(config, [scenario]);

    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { value: string }).value).toBe('Test@123456');
  });

  it('substitutes a safe value when the generated DATA_ENTRY value is destructive', async () => {
    const destructiveGenerator = {
      generate() {
        return 'deletar tudo';
      },
    } as unknown as ValueGeneratorService;
    const destructiveFactory = new ExecutionPlanFactoryService(stubOutcomeResolver, new ActionPolicyService(), destructiveGenerator);
    const scenario = makeScenario('SCN-022', 'Preencher campo', [
      { id: 'T022', title: 'preencher campo', expected: 'Preenchido', status: 'PENDING', expectedOutcome: { kind: 'DATA_ENTRY', description: 'fill' } },
    ]);

    const plan = await destructiveFactory.fromScenarios(config, [scenario]);
    const step = plan!.steps[0];
    expect(step.action.type).toBe('fill');
    expect((step.action as { value: string }).value).toBe('safe-test-value');
  });

  it('emits a safe check step when the single semantic candidate is destructive', async () => {
    const unsafeConfig: RunConfig = {
      ...config,
      runtime: {
        ...config.runtime,
        semanticAliases: { DISCLOSURE: ['delete'] },
      },
    };
    const scenario = makeScenario('SCN-019', 'Abrir destrutivo', [
      { id: 'T019', title: 'Abrir destrutivo', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'options' } },
    ]);

    const plan = await factory.fromScenarios(unsafeConfig, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('returns safe check step when validateDestructiveText throws unexpectedly', async () => {
    const throwingPolicy = {
      validateDestructiveText() {
        throw new Error('policy crashed');
      },
    } as unknown as ActionPolicyService;
    const crashingFactory = new ExecutionPlanFactoryService(stubOutcomeResolver, throwingPolicy, new ValueGeneratorService());
    const scenario = makeScenario('SCN-020', 'Abrir opções', [
      { id: 'T020', title: 'Abrir opções', expected: 'Opções visíveis', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'options' } },
    ]);

    const plan = await crashingFactory.fromScenarios(config, [scenario]);
    expect(plan).toBeDefined();
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('emits safe check step for navigation target with encoded path traversal', async () => {
    const scenario = makeScenario('SCN-021', 'Traversal codificado', [
      { id: 'T021', title: 'Navegar codificado', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: '/%2e%2e/secret', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('emits safe check step for navigation target with double-encoded path traversal', async () => {
    const scenario = makeScenario('SCN-021b', 'Dupla codificação', [
      { id: 'T021b', title: 'Navegar duplo', expected: 'Bloqueado', status: 'PENDING', expectedOutcome: { kind: 'NAVIGATION', target: '/%252e%252e/secret', description: 'navigate' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('returns safe check step for CLASSIFICATION_FAILED outcome', async () => {
    const scenario = makeScenario('SCN-023', 'Classificação falhou', [
      { id: 'T023', title: 'Tarefa classificada', expected: 'Sem erro', status: 'PENDING', expectedOutcome: { kind: 'CLASSIFICATION_FAILED', description: 'unclassifiable' } },
    ]);

    const plan = await factory.fromScenarios(config, [scenario]);
    expect(plan).toBeDefined();
    expect(plan!.steps[0].action.type).toBe('waitForStable');
    expect((plan!.steps[0].action as { reason: string }).reason).toContain('Classification failed');
    expect(plan!.steps[0].isFallback).toBe(true);
  });

  it('returns undefined when no steps can be generated', async () => {
    const scenario = makeScenario('SCN-006', 'Empty', []);
    const plan = await factory.fromScenarios(config, [scenario]);

    expect(plan).toBeUndefined();
  });
});
