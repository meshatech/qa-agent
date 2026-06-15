import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import { LlmProviderError } from '../../domain/errors.js';

const FALLBACK_DISABLED = process.env.AGENT_QA_DISABLE_LLM_FALLBACK === '1' || process.env.AGENT_QA_DISABLE_LLM_FALLBACK === 'true';

export class FallbackLlmProviderAdapter implements LlmProviderPort {
  constructor(
    private readonly primary: LlmProviderPort,
    private readonly fallback: LlmProviderPort,
  ) {}

  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    try {
      return await this.primary.complete(input);
    } catch (error) {
      if (!FALLBACK_DISABLED && error instanceof LlmProviderError && error.isRetryable) {
        return await this.fallback.complete(input);
      }
      throw error;
    }
  }
}
