import { describe, expect, it, vi } from 'vitest';
import { DecisionRouterProvider } from '../src/infra/llm/decision-router.provider.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(provider: RunConfig['llm']['provider']): RunConfig {
  return {
    baseUrl: 'http://127.0.0.1',
    appDomains: ['127.0.0.1'],
    demand: { id: 'D', title: 'T', description: 'D' },
    llm: { provider, model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false },
    auth: { kind: 'none' },
    recovery: { maxAttemptsPerTask: 1, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
  } as unknown as RunConfig;
}

function stubProvider() {
  return {
    plan: vi.fn().mockResolvedValue([]),
    buildPlan: vi.fn().mockResolvedValue({ schemaVersion: 'execution-plan.v1', planId: 'p1', version: 1, goal: 'g', mode: 'HYBRID_GUARDED', runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' }, steps: [], assertions: [] }),
    replan: vi.fn().mockResolvedValue({ basePlanId: 'p1', basePlanVersion: 1, operation: 'mark_blocked', stepId: 's1', reason: 'r', replanReason: 'rr', steps: [] }),
    decide: vi.fn().mockResolvedValue({ schemaVersion: 'action.v1', observationId: 'o1', thought_summary: 't', action: { type: 'waitForStable', reason: 'r' }, expected_after_action: { type: 'no_console_errors' }, fallback_action: { type: 'press', key: 'Escape', reason: 'r' }, confidence: 0.5 }),
    classifyOutcome: vi.fn().mockResolvedValue({ kind: 'NO_REGRESSION', description: 'd' }),
    classifyOutcomes: vi.fn().mockResolvedValue([{ kind: 'NO_REGRESSION', description: 'd' }]),
    orchestrator: vi.fn().mockResolvedValue('{}'),
    stats: vi.fn().mockReturnValue({ calls: 0, wrappers: [], breakdown: { plan: 0, classifyOutcome: 0, buildPlan: 0, replan: 0, decide: 0 } }),
  };
}

describe('DecisionRouterProvider', () => {
  const fake = stubProvider();
  const groq = stubProvider();
  const openai = stubProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = new DecisionRouterProvider(fake as unknown as any, groq as unknown as any, openai as unknown as any);

  const providers: Array<{ name: RunConfig['llm']['provider']; expected: 'groq' | 'openai' | 'fake' }> = [
    { name: 'groq', expected: 'groq' },
    { name: 'openai', expected: 'openai' },
    { name: 'openrouter', expected: 'openai' },
    { name: 'claude', expected: 'openai' },
    { name: 'fake', expected: 'fake' },
  ];

  for (const { name, expected } of providers) {
    it(`routes ${name} to ${expected}`, async () => {
      const config = makeConfig(name);
      await router.plan(config);
      if (expected === 'groq') expect(groq.plan).toHaveBeenCalled();
      else if (expected === 'openai') expect(openai.plan).toHaveBeenCalled();
      else expect(fake.plan).toHaveBeenCalled();
    });
  }

  it('aggregates stats from all providers', () => {
    groq.stats.mockReturnValue({ calls: 3, tokensIn: 1000, tokensOut: 500, wrappers: ['w1'], breakdown: { plan: 1, classifyOutcome: 0, buildPlan: 0, replan: 0, decide: 2 } });
    openai.stats.mockReturnValue({ calls: 5, tokensIn: 2000, tokensOut: 800, wrappers: ['w2'], breakdown: { plan: 2, classifyOutcome: 1, buildPlan: 0, replan: 1, decide: 1 } });
    fake.stats.mockReturnValue({ calls: 0, tokensIn: 0, tokensOut: 0, wrappers: [], breakdown: { plan: 0, classifyOutcome: 0, buildPlan: 0, replan: 0, decide: 0 } });

    const result = router.stats();

    expect(result.calls).toBe(8);
    expect(result.tokensIn).toBe(3000);
    expect(result.tokensOut).toBe(1300);
    expect(result.wrappers.groq).toEqual(['w1']);
    expect(result.wrappers.openai).toEqual(['w2']);
    expect(result.breakdown.groq.decide).toBe(2);
    expect(result.breakdown.openai.plan).toBe(2);
  });
});
