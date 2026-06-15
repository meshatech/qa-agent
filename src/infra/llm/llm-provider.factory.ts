import type { LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import { GroqLlmProviderAdapter } from './groq-llm-provider.adapter.js';
import { OpenAiLlmProviderAdapter } from './openai-llm-provider.adapter.js';
import { ClaudeLlmProviderAdapter } from './claude-llm-provider.adapter.js';
import { OpenRouterLlmProviderAdapter } from './openrouter-llm-provider.adapter.js';
import { FakeLlmProviderAdapter } from './fake-llm-provider.adapter.js';
import { FallbackLlmProviderAdapter } from './fallback-llm-provider.adapter.js';

export class LlmProviderFactory {
  static createForConfig(config: RunConfig): LlmProviderPort {
    const primary = this.resolveProvider(config.llm.provider, config.llm.model);
    const fallback = config.llm.fallbackProvider
      ? this.resolveProvider(config.llm.fallbackProvider, config.llm.fallbackModel)
      : undefined;

    if (fallback) {
      return new FallbackLlmProviderAdapter(primary, fallback);
    }

    return primary;
  }

  static resolveProvider(provider: string, _model?: string): LlmProviderPort {
    switch (provider) {
      case 'groq':
        return new GroqLlmProviderAdapter();
      case 'openai':
        return new OpenAiLlmProviderAdapter();
      case 'claude':
        return new ClaudeLlmProviderAdapter();
      case 'openrouter':
        return new OpenRouterLlmProviderAdapter();
      case 'fake':
        return new FakeLlmProviderAdapter();
      default:
        return new FakeLlmProviderAdapter();
    }
  }
}
