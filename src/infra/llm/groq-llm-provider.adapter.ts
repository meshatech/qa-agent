import { Injectable } from '@nestjs/common';
import type { LlmCompleteInput, LlmCompleteResult, LlmProviderPort } from '../../application/ports/llm-provider.port.js';
import { LlmProviderError } from '../../domain/errors.js';
import { toFriendlyLlmErrorMessage } from './llm-error-helper.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CONTEXT_SLICE = 2800;

@Injectable()
export class GroqLlmProviderAdapter implements LlmProviderPort {
  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const key = process.env.GROQ_API_KEY ?? process.env.GROQ_PROVIDER;
    if (!key) {
      throw new LlmProviderError('GROQ_API_KEY or GROQ_PROVIDER not set. Set it as env var or pass llmApiKey.');
    }

    const model = input.model ?? DEFAULT_MODEL;
    const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
    const contextSlice = input.maxTokens ? Math.min(input.maxTokens * 0.8, DEFAULT_CONTEXT_SLICE) : DEFAULT_CONTEXT_SLICE;
    const phase = input.phase ?? 'unknown';

    const body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: input.systemPrompt ?? '' },
        { role: 'user', content: `Phase: ${phase}\n\n${input.context.slice(0, Math.floor(contextSlice))}` },
      ],
    };

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const raw = `Groq error ${res.status}: ${text}`;
      throw new LlmProviderError(
        toFriendlyLlmErrorMessage(raw, res.status),
        res.status,
        res.status === 429,
        new Error(raw),
      );
    }

    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content ?? '';

    return {
      content,
      model,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    };
  }
}
