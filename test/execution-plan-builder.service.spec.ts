import { describe, expect, it, vi } from 'vitest';
import { ExecutionPlanBuilder } from '../src/application/services/execution-plan-builder.service.js';
import { ExecutionPlanFactoryService } from '../src/application/services/execution-plan-factory.service.js';
import { ExecutionPlanBuildError } from '../src/domain/errors.js';
import { ExecutionPlanSchema } from '../src/domain/schemas/execution-plan.schema.js';
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
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false, engine: 'legacy' },
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

describe('ExecutionPlanBuilder', () => {
  const config = makeConfig();

  it('calls factory and returns valid ExecutionPlan', async () => {
    const factory = { fromScenarios: vi.fn().mockResolvedValue({
      schemaVersion: 'execution-plan.v1',
      planId: 'plan_DEM-001',
      version: 1,
      goal: 'Test Demand',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' },
      steps: [{
        id: 'S001',
        description: 'step',
        preconditions: [],
        action: { type: 'navigate', to: 'http://localhost:3000', reason: 'step' },
        postconditions: [{ type: 'no_console_errors' }],
        assertions: [],
        onFailure: 'RECOVER',
      }],
      assertions: [],
    }) } as unknown as ExecutionPlanFactoryService;

    const builder = new ExecutionPlanBuilder(factory);
    const plan = await builder.build({ scenarios: [makeScenario('SCN-001', 'Test', [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }])], config });

    expect(factory.fromScenarios).toHaveBeenCalledTimes(1);
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('normalizes scenario without tasks and still generates plan', async () => {
    const factory = { fromScenarios: vi.fn().mockImplementation((_cfg: RunConfig, scenarios: QaScenario[]) => {
      const steps = scenarios.flatMap((s) => s.tasks.map((t) => ({
        id: `${t.id}-step`,
        description: t.title,
        preconditions: [],
        action: { type: 'navigate' as const, to: 'http://localhost:3000', reason: t.title },
        postconditions: [{ type: 'no_console_errors' as const }],
        assertions: [],
        onFailure: 'RECOVER' as const,
      })));
      return {
        schemaVersion: 'execution-plan.v1' as const,
        planId: 'plan_DEM-001',
        version: 1,
        goal: 'Test Demand',
        mode: 'HYBRID_GUARDED' as const,
        runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK' as const },
        steps,
        assertions: [],
      };
    }) } as unknown as ExecutionPlanFactoryService;

    const builder = new ExecutionPlanBuilder(factory);
    const scenario = makeScenario('SCN-001', 'Empty scenario', []);
    const plan = await builder.build({ scenarios: [scenario], config });

    expect(factory.fromScenarios).toHaveBeenCalledTimes(1);
    const passedScenarios = (factory.fromScenarios as ReturnType<typeof vi.fn>).mock.calls[0][1] as QaScenario[];
    expect(passedScenarios[0].tasks.length).toBe(1);
    expect(passedScenarios[0].tasks[0].title).toBe('Empty scenario');
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('throws ExecutionPlanBuildError when scenarios is empty', async () => {
    const factory = { fromScenarios: vi.fn() } as unknown as ExecutionPlanFactoryService;
    const builder = new ExecutionPlanBuilder(factory);

    await expect(builder.build({ scenarios: [], config })).rejects.toThrow(ExecutionPlanBuildError);
    expect(factory.fromScenarios).not.toHaveBeenCalled();
  });

  it('throws ExecutionPlanBuildError when factory returns undefined', async () => {
    const factory = { fromScenarios: vi.fn().mockResolvedValue(undefined) } as unknown as ExecutionPlanFactoryService;
    const builder = new ExecutionPlanBuilder(factory);

    await expect(builder.build({ scenarios: [makeScenario('SCN-001', 'Test', [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }])], config })).rejects.toThrow(ExecutionPlanBuildError);
  });

  it('throws ExecutionPlanBuildError when plan fails schema validation', async () => {
    const factory = { fromScenarios: vi.fn().mockResolvedValue({ invalid: true }) } as unknown as ExecutionPlanFactoryService;
    const builder = new ExecutionPlanBuilder(factory);

    await expect(builder.build({ scenarios: [makeScenario('SCN-001', 'Test', [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }])], config })).rejects.toThrow(ExecutionPlanBuildError);
  });

  it('includes steps from multiple scenarios', async () => {
    const stubOutcomeResolver = { async resolve() { return { kind: 'NO_REGRESSION' as const, description: 'x' }; } } as unknown as import('../src/application/services/expected-outcome-resolver.service.js').ExpectedOutcomeResolverService;
    const factory = new ExecutionPlanFactoryService(stubOutcomeResolver);
    const builder = new ExecutionPlanBuilder(factory);
    const scenarios = [
      makeScenario('SCN-001', 'Cenario A', [{ id: 'T001', title: 'clicar botao A', expected: 'A', status: 'PENDING' }]),
      makeScenario('SCN-002', 'Cenario B', [{ id: 'T002', title: 'clicar botao B', expected: 'B', status: 'PENDING' }]),
    ];

    const plan = await builder.build({ scenarios, config });

    expect(plan.steps.length).toBe(2);
    expect(plan.steps.some((s) => s.scenarioId === 'SCN-001')).toBe(true);
    expect(plan.steps.some((s) => s.scenarioId === 'SCN-002')).toBe(true);
  });
});
