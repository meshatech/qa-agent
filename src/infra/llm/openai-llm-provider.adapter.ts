import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import { LlmProviderError } from '../../domain/errors.js';
import { toFriendlyLlmErrorMessage } from './llm-error-helper.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;

@Injectable()
export class OpenAiLlmProviderAdapter implements LlmProviderPort {
  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_PROVIDER;
    if (!apiKey) {
      throw new LlmProviderError('OPENAI_API_KEY or OPENAI_PROVIDER not set.');
    }

    const client = new OpenAI({ apiKey });
    const model = input.model ?? DEFAULT_MODEL;
    const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

    try {
      const response = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: input.systemPrompt ?? '' },
          { role: 'user', content: input.context },
        ],
      });

      const choice = response.choices[0];
      return {
        content: choice?.message?.content ?? '',
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        const raw = `OpenAI API error: ${error.message}`;
        throw new LlmProviderError(
          toFriendlyLlmErrorMessage(raw, error.status ?? undefined),
          error.status ?? undefined,
          error.status === 429,
          error,
        );
      }
      const raw = `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`;
      throw new LlmProviderError(
        toFriendlyLlmErrorMessage(raw),
        undefined,
        false,
        error,
      );
    }
  }
}
