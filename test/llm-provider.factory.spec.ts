import { describe, expect, it } from 'vitest';

import { LlmProviderFactory } from '../src/infra/llm/llm-provider.factory.js';
import { FallbackLlmProviderAdapter } from '../src/infra/llm/fallback-llm-provider.adapter.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(overrides: Partial<RunConfig['llm']> = {}): RunConfig {
  return {
    baseUrl: 'https://example.com',
    appDomains: ['example.com'],
    demand: { id: 'd1', title: 'Test', description: 'Test' },
    llm: {
      provider: 'fake',
      model: 'fake',
      apiKeyEnv: 'FAKE_KEY',
      maxSchemaRetries: 2,
      promptVersion: 'v1',
      temperature: 0,
      maxTokens: 2048,
      rateLimitRetries: 3,
      rateLimitMaxWaitMs: 30000,
      ...overrides,
    },
  } as unknown as RunConfig;
}

describe('LlmProviderFactory', () => {
  it('creates fake provider by default', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig());
    expect(provider).toBeDefined();
  });

  it('creates groq provider', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig({ provider: 'groq' }));
    expect(provider).toBeDefined();
  });

  it('creates openai provider', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig({ provider: 'openai' }));
    expect(provider).toBeDefined();
  });

  it('creates claude provider', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig({ provider: 'claude' }));
    expect(provider).toBeDefined();
  });

  it('creates openrouter provider', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig({ provider: 'openrouter' }));
    expect(provider).toBeDefined();
  });

  it('wraps with fallback when fallbackProvider is set', () => {
    const provider = LlmProviderFactory.createForConfig(
      makeConfig({ provider: 'groq', fallbackProvider: 'openai' }),
    );
    expect(provider).toBeInstanceOf(FallbackLlmProviderAdapter);
  });

  it('does not wrap fallback when fallbackProvider is absent', () => {
    const provider = LlmProviderFactory.createForConfig(makeConfig({ provider: 'groq' }));
    expect(provider).not.toBeInstanceOf(FallbackLlmProviderAdapter);
  });
});
