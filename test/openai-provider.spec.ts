import { describe, expect, it } from 'vitest';
import { OpenAiLangChainDecisionProvider } from '../src/infra/llm/openai-langchain-decision.provider.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

describe('OpenAiLangChainDecisionProvider', () => {
  it('fails fast when api key env is missing', async () => {
    const provider = new OpenAiLangChainDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'openai', model: 'gpt-test', apiKeyEnv: 'MISSING_OPENAI_KEY_FOR_TEST' },
    });
    await expect(provider.plan(config)).rejects.toThrow(/Missing env/);
  });

  const realKey = process.env.OPENAI_API_KEY;
  const itReal = realKey && process.env.RUN_REAL_LLM_TESTS === '1' ? it : it.skip;

  itReal('plans real scenarios via OpenAI (gated by RUN_REAL_LLM_TESTS=1 + OPENAI_API_KEY)', async () => {
    const provider = new OpenAiLangChainDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'DEM', title: 'Cadastro', description: 'Validar cadastro de produto', acceptanceCriteria: ['Produto aparece na listagem', 'Campos obrigatórios bloqueiam submit'] },
      llm: { provider: 'openai', model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY', maxSchemaRetries: 1 },
    });
    const scenarios = await provider.plan(config);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]!.tasks.length).toBeGreaterThan(0);
  }, 60000);
});
