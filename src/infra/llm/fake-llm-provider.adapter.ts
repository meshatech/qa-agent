import { Injectable } from '@nestjs/common';

import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';

@Injectable()
export class FakeLlmProviderAdapter implements LlmProviderPort {
  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const phase = input.phase ?? 'unknown';
    return {
      content: `[fake-llm] phase=${phase} | context-length=${input.context.length}`,
      model: 'fake',
      usage: {
        promptTokens: input.context.length,
        completionTokens: 0,
        totalTokens: input.context.length,
      },
    };
  }
}
