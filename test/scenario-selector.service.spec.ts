import { describe, expect, it, vi } from 'vitest';

import { ScenarioSelectorService } from '../src/application/services/scenario-selector.service.js';
import type { MemoryChunk, MemorySearchResponse } from '../src/domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../src/domain/schemas/correlation.schema.js';
import type { MemorySearchService } from '../src/application/services/memory-search.service.js';

describe('ScenarioSelectorService', () => {
  function makeChunk(id: string, title: string, content: string, metadata?: Record<string, unknown>): MemoryChunk {
    return { id, type: 'scenario', title, content, sourceFile: '.agent-qa/memory.md', metadata };
  }

  function makeRequired(id: string, title: string, rationale: string, relatedFiles?: string[]): RequiredScenario {
    return { id, title, intent: 'POSITIVE', rationale, relatedFiles: relatedFiles ?? [], riskScore: 0.5 };
  }

  function createMockMemorySearch(response: MemorySearchResponse): MemorySearchService {
    return {
      search: vi.fn().mockResolvedValue(response),
    } as unknown as MemorySearchService;
  }

  describe('select (legacy synchronous selection)', () => {
    const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));

    function makeRequiredSync(id: string, title: string, rationale: string): RequiredScenario {
      return { id, title, intent: 'POSITIVE', rationale, relatedFiles: [], riskScore: 0.5 };
    }

    it('selects scenario when title and content overlap with RequiredScenario', () => {
      const chunks = [
        makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.'),
      ];
      const required = [makeRequiredSync('REQ-001', 'Fluxo de login usuario', 'Validar que usuario consegue fazer login informando email e senha corretos para acessar area autenticada')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBe(1);
      expect(result.selectedScenarios[0].id).toBe('SCN-LOGIN-001');
      expect(result.selectedScenarios[0].title).toBe('Login autenticado');
      expect(result.selectedScenarios[0].tasks[0].id).toBe('T001');
      expect(result.metadata[0].requiredId).toBe('REQ-001');
      expect(result.metadata[0].matchedChunkId).toBe('SCN-LOGIN-001');
      expect(result.metadata[0].score).toBeGreaterThan(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns empty array and warning when no scenario chunks exist', () => {
      const required = [makeRequiredSync('REQ-001', 'Logout', 'Usuário sai do sistema')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: [] });

      expect(result.selectedScenarios).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('No scenario chunks'))).toBe(true);
      expect(result.metadata).toHaveLength(0);
    });

    it('returns empty array and warning when no RequiredScenario provided', () => {
      const chunks = [makeChunk('SCN-001', 'Tema escuro', 'Alternar aparência da aplicação')];

      const result = service.select({ requiredScenarios: [], scenarioChunks: chunks });

      expect(result.selectedScenarios).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('No RequiredScenario'))).toBe(true);
    });

    it('returns empty array and warning when no match meets threshold', () => {
      const chunks = [makeChunk('SCN-001', 'Cadastro de produto', 'Preencher nome e preço e salvar.')];
      const required = [makeRequiredSync('REQ-001', 'Logout do usuário', 'Encerrar sessão e redirecionar para login')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('No scenario matched'))).toBe(true);
    });

    it('deduplicates by chunk id when multiple RequiredScenarios match the same chunk', () => {
      const chunks = [
        makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuário preenche e-mail e senha, entra na área autenticada.'),
      ];
      const required = [
        makeRequiredSync('REQ-001', 'Login com email', 'Validar login usando email e senha'),
        makeRequiredSync('REQ-002', 'Área autenticada', 'Confirmar que usuário entra na área interna'),
      ];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBe(1);
      expect(result.selectedScenarios[0].id).toBe('SCN-LOGIN-001');
      expect(result.metadata.length).toBeGreaterThanOrEqual(1);
      const chunkOccurrences = result.metadata.filter((m) => m.matchedChunkId === 'SCN-LOGIN-001').length;
      expect(chunkOccurrences).toBe(1);
    });

    it('selects multiple distinct scenarios when they match different RequiredScenarios', () => {
      const chunks = [
        makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha validas para acessar a area autenticada do sistema.'),
        makeChunk('SCN-LOGOUT-001', 'Logout do sistema', 'Usuario autenticado clica no botao sair e o sistema encerra a sessao redirecionando para tela de login.'),
      ];
      const required = [
        makeRequiredSync('REQ-001', 'Login com credenciais validas', 'Usuario deve conseguir fazer login informando email e senha corretos para acessar area autenticada'),
        makeRequiredSync('REQ-002', 'Encerrar sessao logout', 'Usuario autenticado deve conseguir sair do sistema e ser redirecionado para tela de login'),
      ];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBe(2);
      const ids = result.selectedScenarios.map((s) => s.id).sort();
      expect(ids).toEqual(['SCN-LOGIN-001', 'SCN-LOGOUT-001']);
    });

    it('limits results to MAX_SELECTED_SCENARIOS', () => {
      const chunks = Array.from({ length: 15 }, (_, i) =>
        makeChunk(`SCN-${String(i).padStart(3, '0')}`, `Login alternativa ${i}`, 'Usuario digita email e senha corretos para fazer login e acessar area autenticada do sistema.'),
      );
      const required = [makeRequiredSync('REQ-001', 'Login do usuario', 'Validar que usuario consegue fazer login informando email e senha corretos')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBeLessThanOrEqual(10);
    });

    it('extracts intent from chunk metadata when present', () => {
      const chunks = [
        makeChunk('SCN-EDGE-001', 'Limite de tentativas login', 'Usuario digita senha errada repetidas vezes e o sistema bloqueia a conta temporariamente.', { intent: 'EDGE' }),
      ];
      const required = [makeRequiredSync('REQ-001', 'Bloqueio por tentativas de login', 'Validar que sistema bloqueia conta quando usuario digita senha errada muitas vezes')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBe(1);
      expect(result.selectedScenarios[0].intent).toBe('EDGE');
      expect(result.selectedScenarios[0].tasks[0].intent).toBe('EDGE');
    });

    it('defaults intent to POSITIVE when metadata is absent or invalid', () => {
      const chunks = [
        makeChunk('SCN-001', 'Login padrão', 'Usuário faz login normal.', { intent: 'INVALID' }),
        makeChunk('SCN-002', 'Logout padrão', 'Usuário faz logout.'),
      ];
      const required = [
        makeRequiredSync('REQ-001', 'Login', 'Login do usuário'),
        makeRequiredSync('REQ-002', 'Logout', 'Logout do usuário'),
      ];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.every((s) => s.intent === 'POSITIVE')).toBe(true);
    });

    it('truncates expected task content when chunk content is long', () => {
      const longContent = 'a'.repeat(500);
      const chunks = [makeChunk('SCN-001', 'Teste', longContent)];
      const required = [makeRequiredSync('REQ-001', 'Teste', 'Teste qualquer')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios[0].tasks[0].expected).toHaveLength(200);
      expect(result.selectedScenarios[0].tasks[0].expected.endsWith('...')).toBe(true);
    });

    it('ignores short tokens but preserves content words in scoring', () => {
      const chunks = [makeChunk('SCN-001', 'Login page', 'The user can login with email and password.')];
      const required = [makeRequiredSync('REQ-001', 'Login user email password', 'User logs in with email and password')];

      const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

      expect(result.selectedScenarios.length).toBeGreaterThan(0);
    });
  });

  describe('findCatalogItems', () => {
    it('finds scenario catalog items from memory search', async () => {
      const chunk = makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.');
      const mockSearch = createMockMemorySearch({
        chunks: [{ chunk, relevanceScore: 0.9 }],
        warnings: [],
      });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Fluxo de login', 'Validar que usuario consegue fazer login informando email e senha corretos')];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('SCN-LOGIN-001');
      expect(result[0].title).toBe('Login autenticado');
      expect(result[0].source).toBe('memory');
      expect(result[0].memoryChunkId).toBe('SCN-LOGIN-001');
    });

    it('ignores non-scenario chunks', async () => {
      const routeChunk: MemoryChunk = { id: 'ROUTE-001', type: 'route', title: 'Rota login', content: '/login', sourceFile: '.agent-qa/memory.md' };
      const scenarioChunk = makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.');
      const mockSearch = createMockMemorySearch({
        chunks: [
          { chunk: routeChunk, relevanceScore: 0.8 },
          { chunk: scenarioChunk, relevanceScore: 0.9 },
        ],
        warnings: [],
      });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Fluxo de login', 'Validar que usuario consegue fazer login informando email e senha corretos')];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('SCN-LOGIN-001');
    });

    it('maps metadata to ScenarioCatalogItem', async () => {
      const chunk = makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.', {
        id: 'custom-id',
        title: 'Custom Title',
        route: '/login',
        component: 'LoginForm',
        criteria: ['Preencher email', 'Preencher senha'],
        tags: ['auth', 'smoke'],
        priority: 'HIGH',
      });
      const mockSearch = createMockMemorySearch({
        chunks: [{ chunk, relevanceScore: 0.9 }],
        warnings: [],
      });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Fluxo de login', 'Validar que usuario consegue fazer login informando email e senha corretos')];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result[0].id).toBe('custom-id');
      expect(result[0].title).toBe('Custom Title');
      expect(result[0].route).toBe('/login');
      expect(result[0].component).toBe('LoginForm');
      expect(result[0].criteria).toEqual(['Preencher email', 'Preencher senha']);
      expect(result[0].tags).toEqual(['auth', 'smoke']);
      expect(result[0].priority).toBe('HIGH');
    });

    it('uses fallback when metadata is incomplete', async () => {
      const chunk: MemoryChunk = { id: 'SCN-001', type: 'scenario', title: 'Fallback scenario', content: 'This is a test scenario content.', sourceFile: '.agent-qa/memory.md' };
      const mockSearch = createMockMemorySearch({
        chunks: [{ chunk, relevanceScore: 0.5 }],
        warnings: [],
      });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Teste', 'Teste qualquer')];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result[0].id).toBe('SCN-001');
      expect(result[0].title).toBe('Fallback scenario');
      expect(result[0].description).toBe('This is a test scenario content.');
      expect(result[0].memoryChunkId).toBe('SCN-001');
      expect(result[0].source).toBe('memory');
    });

    it('returns empty array when no matches', async () => {
      const mockSearch = createMockMemorySearch({ chunks: [], warnings: [] });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Teste', 'Teste qualquer')];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result).toEqual([]);
    });

    it('deduplicates chunks from multiple required scenarios', async () => {
      const chunk = makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.');
      const mockSearch = createMockMemorySearch({
        chunks: [{ chunk, relevanceScore: 0.9 }],
        warnings: [],
      });
      const service = new ScenarioSelectorService(mockSearch);
      const required = [
        makeRequired('REQ-001', 'Login com email', 'Validar login usando email e senha'),
        makeRequired('REQ-002', 'Login com senha', 'Confirmar login usando senha'),
      ];

      const result = await service.findCatalogItems({ requiredScenarios: required });

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('SCN-LOGIN-001');
    });

    it('uses relatedFiles in query when present', async () => {
      const chunk = makeChunk('SCN-001', 'Rota teste', 'Teste de rota.');
      const searchFn = vi.fn().mockResolvedValue({ chunks: [{ chunk, relevanceScore: 0.7 }], warnings: [] });
      const mockSearch = { search: searchFn } as unknown as MemorySearchService;
      const service = new ScenarioSelectorService(mockSearch);
      const required = [makeRequired('REQ-001', 'Teste', 'Teste qualquer', ['src/routes/login.ts'])];

      await service.findCatalogItems({ requiredScenarios: required });

      expect(searchFn).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('src/routes/login.ts'),
        }),
      );
    });
  });
});
