import { describe, expect, it } from 'vitest';

import { FakeLlmProviderAdapter } from '../src/infra/llm/fake-llm-provider.adapter.js';

describe('FakeLlmProviderAdapter', () => {
  it('returns fake content with context length', async () => {
    const adapter = new FakeLlmProviderAdapter();
    const result = await adapter.complete({
      context: 'test context',
      phase: 'decide',
    });

    expect(result.content).toBe('[fake-llm] phase=decide | context-length=12');
    expect(result.model).toBe('fake');
    expect(result.usage?.totalTokens).toBe(12);
  });

  it('defaults phase to unknown when omitted', async () => {
    const adapter = new FakeLlmProviderAdapter();
    const result = await adapter.complete({ context: 'hello' });

    expect(result.content).toBe('[fake-llm] phase=unknown | context-length=5');
  });
});
