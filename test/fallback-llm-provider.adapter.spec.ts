import { describe, expect, it, vi } from 'vitest';

import { FallbackLlmProviderAdapter } from '../src/infra/llm/fallback-llm-provider.adapter.js';
import { LlmProviderError } from '../src/domain/errors.js';
import type { LlmCompleteResult, LlmProviderPort } from '../src/application/ports/llm-provider.port.js';

function makeProvider(result: LlmCompleteResult, error?: Error | LlmProviderError): LlmProviderPort {
  return {
    async complete() {
      if (error) throw error;
      return result;
    },
  };
}

describe('FallbackLlmProviderAdapter', () => {
  it('returns primary result when primary succeeds', async () => {
    const primary = makeProvider({ content: 'primary', model: 'groq' });
    const fallback = makeProvider({ content: 'fallback', model: 'openai' });
    const adapter = new FallbackLlmProviderAdapter(primary, fallback);

    const result = await adapter.complete({ context: 'test' });
    expect(result.content).toBe('primary');
  });

  it('falls back to secondary on retryable LlmProviderError (429)', async () => {
    const primary = makeProvider({ content: 'primary', model: 'groq' }, new LlmProviderError('Rate limited', 429, true));
    const fallback = makeProvider({ content: 'fallback', model: 'openai' });
    const adapter = new FallbackLlmProviderAdapter(primary, fallback);

    const result = await adapter.complete({ context: 'test' });
    expect(result.content).toBe('fallback');
  });

  it('re-throws non-retryable errors without fallback', async () => {
    const primary = makeProvider({ content: 'primary', model: 'groq' }, new LlmProviderError('Bad request', 400, false));
    const fallback = makeProvider({ content: 'fallback', model: 'openai' });
    const adapter = new FallbackLlmProviderAdapter(primary, fallback);

    await expect(adapter.complete({ context: 'test' })).rejects.toThrow('Bad request');
  });

  it('re-throws generic errors without fallback', async () => {
    const primary = makeProvider({ content: 'primary', model: 'groq' }, new Error('Network timeout'));
    const fallback = makeProvider({ content: 'fallback', model: 'openai' });
    const adapter = new FallbackLlmProviderAdapter(primary, fallback);

    await expect(adapter.complete({ context: 'test' })).rejects.toThrow('Network timeout');
  });

  it('does not fallback when AGENT_QA_DISABLE_LLM_FALLBACK is set', async () => {
    process.env.AGENT_QA_DISABLE_LLM_FALLBACK = '1';
    vi.resetModules();
    const { FallbackLlmProviderAdapter: FreshAdapter } = await import('../src/infra/llm/fallback-llm-provider.adapter.js');

    const primary = makeProvider({ content: 'primary', model: 'groq' }, new LlmProviderError('Rate limited', 429, true));
    const fallback = makeProvider({ content: 'fallback', model: 'openai' });
    const adapter = new FreshAdapter(primary, fallback);

    await expect(adapter.complete({ context: 'test' })).rejects.toThrow('Rate limited');
    delete process.env.AGENT_QA_DISABLE_LLM_FALLBACK;
  });
});
