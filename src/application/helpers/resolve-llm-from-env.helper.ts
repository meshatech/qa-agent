/**
 * Resolves LLM provider config from environment variables.
 * Infrastructure concern: reads env — kept in application/helpers for discoverability.
 */
export function resolveLlmFromEnv(env: NodeJS.ProcessEnv): {
  provider: 'openrouter' | 'groq' | 'fake';
  model: string;
  apiKeyEnv: string;
} {
  if (env.OPENROUTER_API_KEY?.trim()) {
    return { provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKeyEnv: 'OPENROUTER_API_KEY' };
  }
  if (env.GROQ_API_KEY?.trim()) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKeyEnv: 'GROQ_API_KEY' };
  }
  return { provider: 'fake', model: 'fake', apiKeyEnv: 'GROQ_PROVIDER' };
}
