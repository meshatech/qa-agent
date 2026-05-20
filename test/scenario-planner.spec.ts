import { describe, expect, it } from 'vitest';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://127.0.0.1',
  appDomains: ['127.0.0.1'],
  demand: { id: 'D', title: 'Demand', description: 'fallback task', acceptanceCriteria: ['task one', 'task two'] },
});

describe('ScenarioPlannerService', () => {
  it('uses provider plan when available', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{ id: 's', title: 'S', status: 'PLANNED', tasks: [{ id: 'T001', title: 'from llm', expected: 'ok', status: 'PENDING' }] }];
      },
      async decide() {
        throw new Error('not used');
      },
    };
    const scenarios = await new ScenarioPlannerService(provider).plan(config);
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
    const scenarios = await new ScenarioPlannerService(provider).plan(config);
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
            { id: 'T001', title: 'Preencher email e senha de login', expected: 'Login enviado', status: 'PENDING' },
            { id: 'T002', title: 'Abrir caixa de entrada', expected: 'Inbox visivel', status: 'PENDING', dependsOn: ['T001'] },
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

    const scenarios = await new ScenarioPlannerService(provider).plan(authConfig);

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
              { id: 'T001', title: 'Verificar área autenticada', expected: 'Área visível', status: 'PENDING' },
              { id: 'T002', title: 'Deslogar', expected: 'Login visível', status: 'PENDING' },
            ],
          },
          {
            id: 's2',
            title: 'Depois',
            status: 'PLANNED',
            tasks: [
              { id: 'T003', title: 'Verificar telas acessadas', expected: 'Sem 5xx', status: 'PENDING' },
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

    const scenarios = await new ScenarioPlannerService(provider).plan(authConfig);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Verificar área autenticada',
      'Verificar telas acessadas',
      'Deslogar',
    ]);
    expect(scenarios[0]?.tasks.map((t) => t.id)).toEqual(['T001', 'T002', 'T003']);
    expect(scenarios[0]?.tasks[2]?.dependsOn).toEqual(['T002']);
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

    const scenarios = await new ScenarioPlannerService(provider).plan(cfg);

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual([
      'Uma área autenticada fica visível',
      'O tema visual da aplicação é alterado sem erro crítico',
    ]);
  });

  it('filters global safety tasks returned by provider in authenticated plans', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            { id: 'T001', title: 'Verificar área autenticada', expected: 'Área autenticada visível', status: 'PENDING' },
            { id: 'T002', title: 'Verificar não execução de ações destrutivas', expected: 'Nenhuma ação destrutiva executada', status: 'PENDING' },
            { id: 'T003', title: 'Verificar logout', expected: 'Logout retorna para login', status: 'PENDING' },
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

    const scenarios = await new ScenarioPlannerService(provider).plan(cfg);

    expect(scenarios[0]?.tasks.map((t) => t.title)).toEqual(['Verificar área autenticada', 'Verificar logout']);
  });
});
