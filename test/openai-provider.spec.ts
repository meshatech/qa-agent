import { describe, expect, it, vi } from 'vitest';
import { OpenAiLangChainDecisionProvider } from '../src/infra/llm/openai-langchain-decision.provider.js';
import { FakeDecisionProvider } from '../src/infra/llm/fake-decision.provider.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock;
  },
}));

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

  it('plans scenarios via FakeDecisionProvider without real API key', async () => {
    const provider = new FakeDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'DEM', title: 'Cadastro', description: 'Validar cadastro de produto', acceptanceCriteria: ['Produto aparece na listagem', 'Campos obrigatórios bloqueiam submit'] },
      llm: { provider: 'fake', model: 'fake', apiKeyEnv: 'FAKE_KEY' },
    });
    const scenarios = await provider.plan(config);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]!.tasks.length).toBeGreaterThan(0);
  });

  it('plans scenarios via OpenAI with mocked langchain transport (no real API key)', async () => {
    process.env.OPENAI_TEST_KEY = 'test-key';
    invokeMock.mockResolvedValueOnce({
      content: JSON.stringify({
        scenarios: [{
          id: 'scenario-001',
          title: 'Cadastro de produto',
          tasks: [
            { id: 'T001', title: 'Preencher nome do produto', expected: 'Campo preenchido' },
            { id: 'T002', title: 'Submeter formulário', expected: 'Produto aparece na listagem' },
          ],
        }],
      }),
    });
    const provider = new OpenAiLangChainDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'DEM', title: 'Cadastro', description: 'Validar cadastro de produto', acceptanceCriteria: ['Produto aparece na listagem', 'Campos obrigatórios bloqueiam submit'] },
      llm: { provider: 'openai', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_TEST_KEY', maxSchemaRetries: 1 },
    });
    const scenarios = await provider.plan(config);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]!.tasks.length).toBeGreaterThan(0);
    delete process.env.OPENAI_TEST_KEY;
  });
});
