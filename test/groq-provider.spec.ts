import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroqDecisionProvider } from '../src/infra/llm/groq-decision.provider.js';
import { FakeDecisionProvider } from '../src/infra/llm/fake-decision.provider.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';
import type { ScreenObservation } from '../src/domain/schemas/observation.schema.js';

describe('GroqDecisionProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GROQ_TEST_KEY;
  });

  it('fails fast when api key env is missing', async () => {
    const provider = new GroqDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'MISSING_GROQ_KEY_FOR_TEST' },
    });
    await expect(provider.plan(config)).rejects.toThrow(/Missing env/);
  });

  it('retries plan after Groq 429 using retry-after timing', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 0.01s.' } }), {
        status: 429,
        headers: { 'retry-after': '0' },
      }),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ scenarios: [{ id: 'scenario-001', title: 'Smoke', tasks: [{ id: 'T001', title: 'Abrir inbox', expected: 'Inbox visível' }] }] }) } }],
      }), { status: 200 }),
    );
    const sleepSpy = vi.spyOn(GroqDecisionProvider.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'GROQ_TEST_KEY', rateLimitRetries: 1, rateLimitMaxWaitMs: 1000 },
    });

    const scenarios = await new GroqDecisionProvider().plan(config);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(10);
    expect(scenarios[0]!.tasks[0]!.title).toBe('Abrir inbox');
  });

  it('stops retrying Groq 429 after configured budget', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 0.01s.' } }), { status: 429 }),
    );
    vi.spyOn(GroqDecisionProvider.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'GROQ_TEST_KEY', rateLimitRetries: 1, rateLimitMaxWaitMs: 1000 },
    });

    await expect(new GroqDecisionProvider().plan(config)).rejects.toThrow(/Groq plan error 429/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('repairs common invalid LLM action ids and missing reasons', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        thought_summary: 'Click login',
        action: { type: 'click', targetElementId: '2' },
        expected_after_action: { type: 'element_visible', targetElementId: 'el_2' },
        fallback_action: { type: 'press', key: 'Escape' },
        confidence: 0.7,
      }) } }],
    }), { status: 200 }));
    const provider = new GroqDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'GROQ_TEST_KEY' },
    });

    const decision = await provider.decide({ config, runData: {}, observation: observation() });

    expect(decision.action).toMatchObject({ type: 'click', targetElementId: 'el_002', reason: 'normalized action contract' });
    expect(decision.expected_after_action).toMatchObject({ type: 'element_visible', targetElementId: 'el_002' });
    expect(decision.fallback_action).toMatchObject({ type: 'press', key: 'Escape', reason: 'close transient UI' });
  });

  it('returns abortScenario instead of leaking parser errors after invalid retries', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{ invalid json' } }],
    }), { status: 200 }));
    const provider = new GroqDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'GROQ_TEST_KEY', maxSchemaRetries: 1 },
    });

    const decision = await provider.decide({ config, runData: {}, observation: { ...observation(), elements: [] } });

    expect(decision.action.type).toBe('abortScenario');
    expect(decision.expected_after_action.type).toBe('no_console_errors');
  });

  it('does not keep syntactically valid element ids missing from current observation', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        thought_summary: 'Click stale login element',
        action: { type: 'click', targetElementId: 'el_001', reason: 'try login button' },
        expected_after_action: { type: 'element_visible', targetElementId: 'el_001' },
        fallback_action: { type: 'press', key: 'Escape', reason: 'close dialog' },
        confidence: 0.4,
      }) } }],
    }), { status: 200 }));
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'T', description: 'D' },
      llm: { provider: 'groq', model: 'fake-model', apiKeyEnv: 'GROQ_TEST_KEY' },
    });

    const decision = await new GroqDecisionProvider().decide({ config, runData: {}, observation: { ...observation(), elements: [] } });

    expect(decision.action.type).toBe('waitForStable');
    expect(decision.expected_after_action.type).toBe('no_console_errors');
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

  it('plans scenarios via Groq with mocked transport (no real API key)', async () => {
    process.env.GROQ_TEST_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          scenarios: [{
            id: 'scenario-001',
            title: 'Cadastro de produto',
            tasks: [
              { id: 'T001', title: 'Preencher nome do produto', expected: 'Campo preenchido' },
              { id: 'T002', title: 'Submeter formulário', expected: 'Produto aparece na listagem' },
            ],
          }],
        }) } }],
      }), { status: 200 }),
    );
    const provider = new GroqDecisionProvider();
    const config = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'DEM', title: 'Cadastro', description: 'Validar cadastro de produto', acceptanceCriteria: ['Produto aparece na listagem', 'Campos obrigatórios bloqueiam submit'] },
      llm: { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKeyEnv: 'GROQ_TEST_KEY', maxSchemaRetries: 1 },
    });
    const scenarios = await provider.plan(config);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]!.tasks.length).toBeGreaterThan(0);
  });
});

function observation(): ScreenObservation {
  return {
    observationId: 'obs_1',
    createdAt: new Date().toISOString(),
    url: 'http://127.0.0.1',
    title: 'Login',
    visibleTexts: ['Entrar'],
    elements: [
      { id: 'el_001', role: 'textbox', name: 'Email', inViewport: true, locator: { strategy: 'role', role: 'textbox', name: 'Email' } },
      { id: 'el_002', role: 'button', name: 'Entrar', inViewport: true, locator: { strategy: 'role', role: 'button', name: 'Entrar' } },
    ],
    pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
    consoleSignals: [],
    networkSignals: [],
    meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
  };
}
