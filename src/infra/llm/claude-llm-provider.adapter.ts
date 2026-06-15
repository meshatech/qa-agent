import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import { LlmProviderError } from '../../domain/errors.js';
import { toFriendlyLlmErrorMessage } from './llm-error-helper.js';

const DEFAULT_MODEL = 'claude-3-haiku-20240307';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;

@Injectable()
export class ClaudeLlmProviderAdapter implements LlmProviderPort {
  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_PROVIDER;
    if (!apiKey) {
      throw new LlmProviderError('ANTHROPIC_API_KEY or CLAUDE_PROVIDER not set.');
    }

    const client = new Anthropic({ apiKey });
    const model = input.model ?? DEFAULT_MODEL;
    const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: input.systemPrompt ?? undefined,
        messages: [{ role: 'user', content: input.context }],
      });

      const content = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');

      return {
        content,
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            }
          : undefined,
      };
    } catch (error) {
      const status = (error as { status?: number }).status;
      const raw = `Claude API error: ${error instanceof Error ? error.message : String(error)}`;
      throw new LlmProviderError(
        toFriendlyLlmErrorMessage(raw, status),
        status,
        status === 429,
        error,
      );
    }
  }
}
