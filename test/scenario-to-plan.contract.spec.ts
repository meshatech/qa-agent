import { describe, expect, it } from 'vitest';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import { ExpectedOutcomeResolverService } from '../src/application/services/expected-outcome-resolver.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

describe('Pipeline contract: ScenarioPlanner -> ExecutionPlanFactory', () => {
  const stubOutcomeResolver = {
    async resolve(_cfg: unknown, task: { title: string }) {
      const t = task.title.toLowerCase();
      if (t.includes('logout') || t.includes('sign out') || t.includes('deslogar')) return { kind: 'DEAUTHENTICATION' as const, description: 'logout' };
      if (t.includes('theme') || t.includes('tema')) return { kind: 'APPEARANCE_CHANGE' as const, description: 'theme' };
      if (t.includes('menu') || t.includes('config')) return { kind: 'DISCLOSURE' as const, description: 'menu' };
      return { kind: 'NO_REGRESSION' as const, description: 'safe' };
    },
  } as unknown as ExpectedOutcomeResolverService;
  const factory = new ExecutionPlanFactoryService(stubOutcomeResolver);

  const config = RunConfigSchema.parse({
    baseUrl: 'http://app.local',
    appDomains: ['app.local'],
    demand: { id: 'D1', title: 'Logout flow', description: 'User must be able to log out', acceptanceCriteria: ['User can sign out', 'Verify theme toggle'] },
    auth: { kind: 'formLogin', loginUrl: '/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', usernameEnv: 'U', passwordEnv: 'P' },
  });

  it('fallback infers expectedOutcome and factory emits typed postconditions', async () => {
    const fallbackProvider: DecisionProviderPort = {
      async plan() { throw new Error('no plan'); },
      async decide() { throw new Error('unused'); },
    };

    const planner = new ScenarioPlannerService(fallbackProvider, stubOutcomeResolver);
    const scenarios = await planner.plan(config);

    // Auth-aware policy filters auth tasks and keeps only functional ones
    const plan = await factory.fromScenarios(config, scenarios);

    expect(plan).toBeDefined();
    expect(plan!.steps.length).toBeGreaterThan(0);

    // At least one step should have typed state postconditions (not text_any_visible)
    const typedSteps = plan!.steps.filter(
      (s) => s.postconditions.some((p) => p.type === 'auth_state' || p.type === 'ui_state' || p.type === 'menu_state' || p.type === 'route_state'),
    );
    expect(typedSteps.length).toBeGreaterThan(0);
  });

  it('LLM-provided expectedOutcome flows through to factory postconditions', async () => {
    const provider: DecisionProviderPort = {
      async plan() {
        return [{
          id: 's1',
          title: 'S',
          status: 'PLANNED',
          tasks: [
            {
              id: 'T001',
              title: 'Ir para /dashboard',
              expected: 'Dashboard visível',
              status: 'PENDING',
              expectedOutcome: { kind: 'NAVIGATION', target: '/dashboard', description: 'acessar dashboard' },
            },
            {
              id: 'T002',
              title: 'Encerrar sessão',
              expected: 'Usuário deslogado',
              status: 'PENDING',
              expectedOutcome: { kind: 'DEAUTHENTICATION', description: 'logout' },
            },
          ],
        }];
      },
      async decide() { throw new Error('unused'); },
    };

    const planner = new ScenarioPlannerService(provider, stubOutcomeResolver);
    const scenarios = await planner.plan(config);
    const plan = await factory.fromScenarios(config, scenarios);

    const navStep = plan!.steps.find((s) => s.taskId === 'T001');
    expect(navStep!.postconditions).toEqual([{ type: 'route_state', expected: 'matches', expectedUrlPattern: 'http://app.local/dashboard' }]);

    const logoutStep = plan!.steps.find((s) => s.taskId === 'T002' && s.postconditions.some((p) => p.type === 'auth_state'));
    expect(logoutStep!.postconditions).toEqual([{ type: 'auth_state', expected: 'anonymous' }]);
  });
});
