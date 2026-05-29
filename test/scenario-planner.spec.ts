import { describe, expect, it } from 'vitest';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import { ExpectedOutcomeResolverService } from '../src/application/services/expected-outcome-resolver.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://127.0.0.1',
  appDomains: ['127.0.0.1'],
  demand: { id: 'D', title: 'Demand', description: 'fallback task', acceptanceCriteria: ['task one', 'task two'] },
});

describe('ScenarioPlannerService', () => {
  const resolver = {
    async resolve(_cfg: unknown, task: { title: string }) {
      const t = task.title.toLowerCase();
      if (t.includes('login') || t.includes('logar') || t.includes('entrar') || t.includes('auth')) return { kind: 'AUTHENTICATION' as const, description: 'login' };
      if (t.includes('logout') || t.includes('sair') || t.includes('sign out') || t.includes('deslogar')) return { kind: 'DEAUTHENTICATION' as const, description: 'logout' };
      if (t.includes('tema') || t.includes('theme') || t.includes('apar')) return { kind: 'APPEARANCE_CHANGE' as const, description: 'theme' };
      if (t.includes('menu') || t.includes('config') || t.includes('opções') || t.includes('conta')) return { kind: 'DISCLOSURE' as const, description: 'menu' };
      if (t.includes('navegar') || t.includes('navigate') || t.includes('acessar') || t.includes('access')) return { kind: 'NAVIGATION' as const, description: 'navigate' };
      return { kind: 'NO_REGRESSION' as const, description: 'safe' };
    },
  } as unknown as ExpectedOutcomeResolverService;

  it('uses provider plan when available', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{ id: 's', title: 'S', status: 'PLANNED', tasks: [{ id: 'T001', title: 'from llm', expected: 'ok', status: 'PENDING' }] }];
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(config);
    expect(scenarios[0]?.tasks[0]?.title).toBe('from llm');
  });

  it('falls back to acceptance criteria', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        throw new Error('plan failed');
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(config);
    expect(scenarios[0]?.tasks).toHaveLength(2);
  });

  it('removes login tasks when auth is handled before scenarios', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'T001', title: 'Preencher email e senha de login', expected: 'Login enviado', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'login' } },
            { id: 'T002', title: 'Abrir caixa de entrada', expected: 'Inbox visivel', status: 'PENDING', dependsOn: ['T001'], expectedOutcome: { kind: 'DISCLOSURE', description: 'menu' } },
          ],
        }];
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const authConfig = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Demand', description: 'login e inbox' },
      auth: {
        kind: 'formLogin',
        loginUrl: '/',
        usernameSelector: '#email',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'USER',
        passwordEnv: 'PASS',
      },
    });

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(authConfig);

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual(['Abrir caixa de entrada']);
    expect(scenarios[0]?.tasks[0]?.dependsOn).toBeUndefined();
  });

  it('linearizes authenticated multi-scenario plans and makes logout terminal', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [
          {
            id: 's1',
            title: 'Auth',
            status: 'PLANNED',
            tasks: [
              { id: 'T001', title: 'Verificar área autenticada', expected: 'Área visível', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
              { id: 'T002', title: 'Deslogar', expected: 'Login visível', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
            ],
          },
          {
            id: 's2',
            title: 'Depois',
            status: 'PLANNED',
            tasks: [
              { id: 'T003', title: 'Verificar telas acessadas', expected: 'Sem 5xx', status: 'PENDING', expectedOutcome: { kind: 'CONTENT_PRESENCE', description: 'screens ok' } },
            ],
          },
        ];
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const authConfig = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke autenticado', description: 'validar e sair' },
      auth: {
        kind: 'formLogin',
        loginUrl: '/',
        usernameSelector: '#email',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'USER',
        passwordEnv: 'PASS',
      },
    });

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(authConfig);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Verificar telas acessadas',
      'Deslogar',
    ]);
    expect(scenarios[0]?.tasks.map((t) => t.id)).toEqual(['T001', 'T002']);
    expect(scenarios[0]?.tasks[1]?.dependsOn).toEqual(['T001']);
  });

  it('keeps fallback smoke plan compact by removing global safety checks from task chain', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        throw new Error('plan failed');
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const cfg = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: {
        id: 'D',
        title: 'Smoke',
        description: 'Smoke',
        acceptanceCriteria: [
          'Uma área autenticada fica visível',
          'O tema visual da aplicação é alterado sem erro crítico',
          'Não há erro crítico de console originado pelo domínio da aplicação',
          'Nenhuma ação destrutiva ou envio real é executado',
        ],
      },
    });

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(cfg);

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Uma área autenticada fica visível',
      'O tema visual da aplicação é alterado sem erro crítico',
      'Não há erro crítico de console originado pelo domínio da aplicação',
      'Nenhuma ação destrutiva ou envio real é executado',
    ]);
  });

  it('keeps functional tasks and logout in authenticated plans, removes only login tasks', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'T001', title: 'Verificar área autenticada', expected: 'Área autenticada visível', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
            { id: 'T002', title: 'Verificar não execução de ações destrutivas', expected: 'Nenhuma ação destrutiva executada', status: 'PENDING', expectedOutcome: { kind: 'NO_REGRESSION', description: 'safety' } },
            { id: 'T003', title: 'Verificar logout', expected: 'Logout retorna para login', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
          ],
        }];
      },
      async decide() {
        throw new Error('unused');
      },
    };
    const cfg = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke', description: 'Smoke' },
      auth: {
        kind: 'formLogin',
        loginUrl: '/',
        usernameSelector: '#email',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'USER',
        passwordEnv: 'PASS',
      },
    });

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(cfg);

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Verificar não execução de ações destrutivas',
      'Verificar logout',
    ]);
  });

  it('dedupes verbose provider plans, removes low-value steps, and keeps logout last', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'A', title: 'Clicar botão', expected: 'Avançar', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'click' } },
            { id: 'B', title: 'Verificar área autenticada', expected: 'Área autenticada visível', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
            { id: 'C', title: 'Verificar área autenticada', expected: 'Área autenticada visível', status: 'PENDING', expectedOutcome: { kind: 'AUTHENTICATION', description: 'auth' } },
            { id: 'D', title: 'Deslogar', expected: 'Tela de login visível', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
            { id: 'E', title: 'Abrir configurações', expected: 'Configurações visíveis', status: 'PENDING', expectedOutcome: { kind: 'DISCLOSURE', description: 'menu' } },
          ],
        }];
      },
      async decide() {
        throw new Error('unused');
      },
    };

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'Smoke', description: 'Smoke' },
      auth: {
        kind: 'formLogin',
        loginUrl: '/',
        usernameSelector: '#email',
        passwordSelector: '#password',
        submitSelector: 'button',
        usernameEnv: 'USER',
        passwordEnv: 'PASS',
      },
    }));

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Clicar botão',
      'Abrir configurações',
      'Deslogar',
    ]);
    expect(scenarios[0]?.tasks[2]?.dependsOn).toEqual(['T002']);
  });

  it('canonicalizes vague expectations into verifiable outcomes', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'T001', title: 'Alterar tema visual', expected: 'Tema alterado', status: 'PENDING', expectedOutcome: { kind: 'APPEARANCE_CHANGE', description: 'theme' } },
            { id: 'T002', title: 'Verificar logout', expected: 'Logout feito', status: 'PENDING', expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' } },
          ],
        }];
      },
      async decide() {
        throw new Error('unused');
      },
    };

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(config);

    expect(scenarios[0]?.tasks[0]?.expected).toContain('appearance state');
    expect(scenarios[0]?.tasks[1]?.expected).toContain('deauthentication state');
  });

  it('topologically sorts tasks when provider returns inverted dependency order', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'T002', title: 'Verificar resultado', expected: 'Resultado visível', status: 'PENDING', dependsOn: ['T001'] },
            { id: 'T001', title: 'Executar ação', expected: 'Ação concluída', status: 'PENDING' },
          ],
        }];
      },
      async decide() {
        throw new Error('unused');
      },
    };

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(config);

    expect(scenarios[0]?.tasks.map((t) => t.id)).toEqual(['T001', 'T002']);
    expect(scenarios[0]?.tasks[1]?.dependsOn).toEqual(['T001']);
  });

  it('preserves multiple scenarios and original ids when auth.kind is none', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [
          { id: 's1', title: 'First', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Task 1', expected: 'Ok', status: 'PENDING' }] },
          { id: 's2', title: 'Second', status: 'PLANNED', tasks: [{ id: 'T002', title: 'Task 2', expected: 'Ok', status: 'PENDING' }] },
        ];
      },
      async decide() {
        throw new Error('unused');
      },
    };

    const scenarios = await new ScenarioPlannerService(provider, resolver).plan(config);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]?.id).toBe('s1');
    expect(scenarios[1]?.id).toBe('s2');
  });
});
