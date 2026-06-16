import { describe, expect, it, vi } from 'vitest';
import { OpenAiLangChainDecisionProvider } from '../src/infra/llm/openai-langchain-decision.provider.js';

describe('OpenAiLangChainDecisionProvider token tracking', () => {
  it('accumulates tokens from usage_metadata on each invoke', async () => {
    const provider = new OpenAiLangChainDecisionProvider();

    let invokeCount = 0;
    const mockModel = {
      invoke: vi.fn().mockImplementation(async () => {
        invokeCount++;
        return {
          content: JSON.stringify({
            scenarios: [{
              id: 's1',
              title: 'Test',
              tasks: [{ id: 'T1', title: 'task', expected: 'expected' }],
            }],
          }),
          usage_metadata: {
            input_tokens: 100 * invokeCount,
            output_tokens: 50 * invokeCount,
            total_tokens: 150 * invokeCount,
          },
        };
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).model = () => mockModel;

    const config = {
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D1', title: 'Test', description: 'Desc' },
      llm: { provider: 'openai', model: 'gpt-4', apiKeyEnv: 'TEST_KEY', temperature: 0, maxTokens: 100, maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1' },
      browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
      runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false },
      auth: { kind: 'none' },
      recovery: { maxAttemptsPerTask: 1, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    } as unknown as import('../src/domain/schemas/config.schema.js').RunConfig;

    await provider.plan(config);
    await provider.plan(config);

    const stats = provider.stats();
    expect(stats.tokensIn).toBe(300); // 100 + 200
    expect(stats.tokensOut).toBe(150); // 50 + 100
    expect(stats.calls).toBe(2);
  });

  it('falls back to response_metadata.tokenUsage when usage_metadata is absent', async () => {
    const provider = new OpenAiLangChainDecisionProvider();

    const mockModel = {
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          scenarios: [{
            id: 's1',
            title: 'Test',
            tasks: [{ id: 'T1', title: 'task', expected: 'expected' }],
          }],
        }),
        response_metadata: {
          tokenUsage: {
            input_tokens: 500,
            output_tokens: 250,
            total_tokens: 750,
          },
        },
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).model = () => mockModel;

    const config = {
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D1', title: 'Test', description: 'Desc' },
      llm: { provider: 'openai', model: 'gpt-4', apiKeyEnv: 'TEST_KEY', temperature: 0, maxTokens: 100, maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1' },
      browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
      runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false },
      auth: { kind: 'none' },
      recovery: { maxAttemptsPerTask: 1, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    } as unknown as import('../src/domain/schemas/config.schema.js').RunConfig;

    await provider.plan(config);

    const stats = provider.stats();
    expect(stats.tokensIn).toBe(500);
    expect(stats.tokensOut).toBe(250);
  });

  it('handles missing usage gracefully', async () => {
    const provider = new OpenAiLangChainDecisionProvider();

    const mockModel = {
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          scenarios: [{
            id: 's1',
            title: 'Test',
            tasks: [{ id: 'T1', title: 'task', expected: 'expected' }],
          }],
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).model = () => mockModel;

    const config = {
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D1', title: 'Test', description: 'Desc' },
      llm: { provider: 'openai', model: 'gpt-4', apiKeyEnv: 'TEST_KEY', temperature: 0, maxTokens: 100, maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1' },
      browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
      runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, semanticAliases: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false, allowedContainers: [] }, tools: { enabled: false }, enforceSingleTab: false },
      auth: { kind: 'none' },
      recovery: { maxAttemptsPerTask: 1, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    } as unknown as import('../src/domain/schemas/config.schema.js').RunConfig;

    await provider.plan(config);

    const stats = provider.stats();
    expect(stats.tokensIn).toBe(0);
    expect(stats.tokensOut).toBe(0);
  });
});
