import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import { LlmProviderError } from '../../domain/errors.js';
import { toFriendlyLlmErrorMessage } from './llm-error-helper.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;

@Injectable()
export class OpenRouterLlmProviderAdapter implements LlmProviderPort {
  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_PROVIDER;
    if (!apiKey) {
      throw new LlmProviderError('OPENROUTER_API_KEY or OPENROUTER_PROVIDER not set.');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
    });
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
        const raw = `OpenRouter API error: ${error.message}`;
        throw new LlmProviderError(
          toFriendlyLlmErrorMessage(raw, error.status ?? undefined),
          error.status ?? undefined,
          error.status === 429,
          error,
        );
      }
      const raw = `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`;
      throw new LlmProviderError(
        toFriendlyLlmErrorMessage(raw),
        undefined,
        false,
        error,
      );
    }
  }
}
