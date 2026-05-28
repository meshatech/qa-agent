import { describe, expect, it, vi } from 'vitest';

import { ScenarioOrchestratorService } from '../src/application/services/scenario-orchestrator.service.js';
import { ScenarioGeneratorService } from '../src/application/services/scenario-generator.service.js';
import { ScenarioSelectorService } from '../src/application/services/scenario-selector.service.js';
import type { QaScenario } from '../src/domain/models/run.model.js';
import type { MemoryChunk } from '../src/domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../src/domain/schemas/correlation.schema.js';
import type { RunConfig } from '../src/domain/schemas/config.schema.js';

function makeConfig(): RunConfig {
  return {
    baseUrl: 'https://example.com',
    appDomains: ['example.com'],
    demand: { id: 'DEM-001', title: 'Test', description: 'Test demand', acceptanceCriteria: ['Criterion A'] },
    auth: { kind: 'none' },
    llm: { provider: 'fake', model: 'test', apiKeyEnv: 'TEST_KEY', maxSchemaRetries: 1, rateLimitRetries: 1, rateLimitMaxWaitMs: 1000, promptVersion: 'v1', temperature: 0, maxTokens: 100 },
    browser: { engine: 'chromium', headed: false, viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    timeouts: { quiescenceMs: 1000, actionMs: 5000, navigationMs: 10000, scenarioMs: 60000, runMs: 300000 },
    runtime: { maxActionsPerTask: 5, mode: 'HYBRID_GUARDED', maxAttemptsPerStep: 2, maxReplansPerScenario: 2, destructiveActionPolicy: 'BLOCK', semanticKeys: {}, elementAvailability: { enabled: true, maxOpenAttempts: 1, allowGlobalEscape: false, allowClickOutside: false }, tools: { enabled: false } },
    recovery: { maxAttemptsPerTask: 2, maxFallbacksPerStep: 1, maxEmergencyActionsPerScenario: 1 },
    classifier: { knownNoiseRegexes: [], knownTrackingDomains: [], treatThirdPartyNetwork5xxAsBug: false },
    privacy: { maskEmails: true, maskJwt: true, maskCookies: true },
    output: { runsDir: './qa-agent-runs', keepVideoOnPass: false, keepScreenshotOnPass: false, keepTraceOnPass: false },
    scenarioSelection: { maxScenarios: 5 },
    agentVersion: '0.1.0',
  };
}

function makeChunk(id: string, title: string, content: string): MemoryChunk {
  return { id, type: 'scenario', title, content, sourceFile: '.agent-qa/memory.md' };
}

function makeRequired(id: string, title: string, rationale: string): RequiredScenario {
  return { id, title, intent: 'POSITIVE', rationale, relatedFiles: [], riskScore: 0.5 };
}

function createMockMemorySearch(): import('../src/application/services/memory-search.service.js').MemorySearchService {
  return {
    search: vi.fn().mockResolvedValue({ chunks: [], warnings: [] }),
  } as unknown as import('../src/application/services/memory-search.service.js').MemorySearchService;
}

describe('ScenarioOrchestratorService', () => {
  const selector = new ScenarioSelectorService(createMockMemorySearch());
  const generator = { generate: vi.fn() } as unknown as ScenarioGeneratorService;
  const orchestrator = new ScenarioOrchestratorService(selector, generator);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. all covered by memory — selected only, planner not called', async () => {
    const chunks = [
      makeChunk('SCN-LOGIN-001', 'Login usuario', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.'),
      makeChunk('SCN-LOGOUT-001', 'Logout sistema', 'Usuario autenticado clica em sair e volta para tela de login.'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login do usuario', 'Validar que usuario consegue fazer login informando email e senha corretos'),
      makeRequired('REQ-002', 'Encerrar sessao', 'Usuario autenticado deve conseguir sair e ser redirecionado para login'),
    ];
    const config = makeConfig();

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selected.length).toBe(2);
    expect(result.generated).toHaveLength(0);
    expect(result.uncoveredRequiredScenarios).toHaveLength(0);
    expect(result.scenarios.length).toBe(2);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('2. nothing covered — planner called for all, selected empty', async () => {
    const chunks = [makeChunk('SCN-001', 'Cadastro produto', 'Preencher nome e preco e salvar.')];
    const required = [makeRequired('REQ-001', 'Logout do usuario', 'Usuario realiza logout e volta para login')];
    const config = makeConfig();
    const generated: QaScenario[] = [{ id: 'scenario-001', title: 'Logout', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Logout', expected: 'Logout ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selected).toHaveLength(0);
    expect(result.generated).toEqual(generated);
    expect(result.uncoveredRequiredScenarios).toEqual(['REQ-001']);
    expect(result.scenarios).toEqual(generated);
    expect(result.warnings.some((w) => w.includes('Uncovered'))).toBe(true);
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });

  it('3. partial coverage — merges selected + generated', async () => {
    const chunks = [
      makeChunk('SCN-LOGIN-001', 'Login usuario', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login do usuario', 'Validar que usuario consegue fazer login informando email e senha corretos'),
      makeRequired('REQ-002', 'Encerrar sessao', 'Usuario autenticado deve conseguir sair e ser redirecionado para login'),
    ];
    const config = makeConfig();
    const generated: QaScenario[] = [{ id: 'scenario-logout', title: 'Logout', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Logout', expected: 'Logout ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selected.length).toBe(1);
    expect(result.selected[0].id).toBe('SCN-LOGIN-001');
    expect(result.generated).toEqual(generated);
    expect(result.uncoveredRequiredScenarios).toEqual(['REQ-002']);
    expect(result.scenarios.length).toBe(2);
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });

  it('4. no RequiredScenario — returns empty controlled', async () => {
    const config = makeConfig();
    const generated: QaScenario[] = [{ id: 'scenario-001', title: 'Default', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Task', expected: 'Ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config });

    expect(result.scenarios).toEqual(generated);
    expect(result.selected).toHaveLength(0);
    expect(result.generated).toEqual(generated);
    expect(result.uncoveredRequiredScenarios).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('No required scenarios'))).toBe(true);
  });

  it('5. respects max scenario limit with default 5', async () => {
    const chunks = Array.from({ length: 15 }, (_, i) =>
      makeChunk(`SCN-${String(i).padStart(3, '0')}`, `Login alternativa ${i}`, 'Usuario digita email e senha corretos para fazer login e acessar area autenticada do sistema.'),
    );
    const required = [makeRequired('REQ-001', 'Login do usuario', 'Validar que usuario consegue fazer login informando email e senha corretos')];
    const config = makeConfig();

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.scenarios.length).toBeLessThanOrEqual(5);
    expect(result.selected.length).toBeGreaterThan(0);
  });

  it('6. truncates and emits warning when total exceeds maxScenarios', async () => {
    const chunks = [
      makeChunk('SCN-001', 'Login A', 'Usuario preenche email senha login validar'),
      makeChunk('SCN-002', 'Login B', 'Usuario preenche email senha login validar alternativa'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login A', 'Validar login A'),
      makeRequired('REQ-002', 'Login B', 'Validar login B'),
      makeRequired('REQ-003', 'Login C', 'Validar login C'),
    ];
    const config = { ...makeConfig(), scenarioSelection: { maxScenarios: 2 } };
    const generated: QaScenario[] = [{ id: 'scenario-003', title: 'Login C', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Login C', expected: 'Ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.scenarios.length).toBe(2);
    expect(result.warnings.some((w) => w.includes('Scenario limit applied'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('maxScenarios=2'))).toBe(true);
  });

  it('7. selected is prioritized over generated when limit is reached', async () => {
    const chunks = [
      makeChunk('SCN-001', 'Login A', 'Usuario preenche email senha login validar'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login A', 'Validar login A'),
      makeRequired('REQ-002', 'Login B', 'Validar login B'),
    ];
    const config = { ...makeConfig(), scenarioSelection: { maxScenarios: 1 } };
    const generated: QaScenario[] = [{ id: 'scenario-002', title: 'Login B', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Login B', expected: 'Ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.scenarios.length).toBe(1);
    expect(result.scenarios[0].id).toBe('SCN-001');
  });

  it('8. deduplicates before applying limit', async () => {
    const chunks = [
      makeChunk('SCN-001', 'Login A', 'Usuario preenche email senha login validar'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login A', 'Validar login A'),
      makeRequired('REQ-002', 'Login B', 'Validar login B'),
    ];
    const config = { ...makeConfig(), scenarioSelection: { maxScenarios: 1 } };
    const generated: QaScenario[] = [{ id: 'SCN-001', title: 'Login A duplicate', status: 'PLANNED', tasks: [{ id: 'T001', title: 'Login A', expected: 'Ok', status: 'PENDING' }] }];
    vi.mocked(generator.generate).mockResolvedValue({ generated, warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.scenarios.length).toBe(1);
    expect(result.scenarios[0].id).toBe('SCN-001');
  });

  it('9. no truncation warning when total <= maxScenarios', async () => {
    const chunks = [
      makeChunk('SCN-001', 'Login A', 'Usuario preenche email senha login validar'),
    ];
    const required = [makeRequired('REQ-001', 'Login A', 'Validar login A')];
    const config = makeConfig();
    vi.mocked(generator.generate).mockResolvedValue({ generated: [], warnings: [] });

    const result = await orchestrator.orchestrate({ config, requiredScenarios: required, scenarioChunks: chunks });

    expect(result.scenarios.length).toBe(1);
    expect(result.warnings.some((w) => w.includes('Scenario limit applied'))).toBe(false);
  });
});
