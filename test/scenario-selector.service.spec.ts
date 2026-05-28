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

  describe('selectByRoute', () => {
    function makeCatalogItem(id: string, title: string, route?: string): import('../src/domain/models/scenario-catalog-item.model.js').ScenarioCatalogItem {
      return { id, title, source: 'memory', route };
    }

    it('selects item with exact route match', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('selects item with child route', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Profile', '/login/profile')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('does not select parent route when only child is affected', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login')];

      const result = service.selectByRoute({ affectedRoutes: ['/login/profile'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('does not select substring that is not a prefix', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Admin Login', '/admin/login'),
        makeCatalogItem('SCN-002', 'Login History', '/login-history'),
      ];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('does not select unrelated routes', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Logout', '/logout')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('normalizes trailing slashes', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login/')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(1);
    });

    it('normalizes query strings', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login?foo=bar')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(1);
    });

    it('normalizes hashes', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login#form')];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(1);
    });

    it('handles multiple affected routes', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Login', '/login'),
        makeCatalogItem('SCN-002', 'Dashboard', '/dashboard'),
        makeCatalogItem('SCN-003', 'Settings', '/settings'),
      ];

      const result = service.selectByRoute({ affectedRoutes: ['/login', '/dashboard'], catalogItems: items });

      expect(result).toHaveLength(2);
      const ids = result.map((i) => i.id).sort();
      expect(ids).toEqual(['SCN-001', 'SCN-002']);
    });

    it('deduplicates items matching multiple routes', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login Profile', '/login/profile')];

      const result = service.selectByRoute({ affectedRoutes: ['/login', '/login/profile'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('returns empty array when affectedRoutes is empty', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', '/login')];

      const result = service.selectByRoute({ affectedRoutes: [], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('ignores items without route', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Generic', undefined)];

      const result = service.selectByRoute({ affectedRoutes: ['/login'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('preserves original catalog order', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-002', 'Dashboard', '/dashboard'),
        makeCatalogItem('SCN-001', 'Login', '/login'),
      ];

      const result = service.selectByRoute({ affectedRoutes: ['/login', '/dashboard'], catalogItems: items });

      expect(result.map((i) => i.id)).toEqual(['SCN-002', 'SCN-001']);
    });
  });

  describe('selectByComponent', () => {
    function makeCatalogItem(id: string, title: string, component?: string): import('../src/domain/models/scenario-catalog-item.model.js').ScenarioCatalogItem {
      return { id, title, source: 'memory', component };
    }

    it('selects item with exact component match', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login Form', 'LoginForm')];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('selects item with normalized separator match', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login Form', 'login-form')];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('does not select by substring', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Form', 'Form'),
        makeCatalogItem('SCN-002', 'Login', 'Login'),
      ];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('handles multiple affected components', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Login', 'LoginForm'),
        makeCatalogItem('SCN-002', 'Dashboard', 'DashboardCard'),
        makeCatalogItem('SCN-003', 'Settings', 'SettingsPanel'),
      ];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm', 'DashboardCard'], catalogItems: items });

      expect(result).toHaveLength(2);
      const ids = result.map((i) => i.id).sort();
      expect(ids).toEqual(['SCN-001', 'SCN-002']);
    });

    it('deduplicates items matching multiple components', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login Form', 'LoginForm')];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm', 'login-form'], catalogItems: items });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('SCN-001');
    });

    it('returns empty array when affectedComponents is empty', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', 'LoginForm')];

      const result = service.selectByComponent({ affectedComponents: [], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('ignores items without component', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Generic', undefined)];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm'], catalogItems: items });

      expect(result).toHaveLength(0);
    });

    it('preserves original catalog order', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-002', 'Dashboard', 'DashboardCard'),
        makeCatalogItem('SCN-001', 'Login', 'LoginForm'),
      ];

      const result = service.selectByComponent({ affectedComponents: ['LoginForm', 'DashboardCard'], catalogItems: items });

      expect(result.map((i) => i.id)).toEqual(['SCN-002', 'SCN-001']);
    });
  });

  describe('selectByCriteria', () => {
    function makeCatalogItem(id: string, title: string, criteria?: string[]): import('../src/domain/models/scenario-catalog-item.model.js').ScenarioCatalogItem {
      return { id, title, source: 'memory', criteria };
    }

    it('selects item with strong token overlap', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', ['O usuario preenche email e senha para fazer login'])];

      const result = service.selectByCriteria({
        acceptanceCriteria: ['O usuario deve conseguir fazer login informando email e senha'],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(1);
      expect(result.selectedItems[0].id).toBe('SCN-001');
      expect(result.uncoveredCriteria).toHaveLength(0);
    });

    it('does not select item with irrelevant text', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Logout', ['O usuario clica no botao sair para encerrar sessao'])];

      const result = service.selectByCriteria({
        acceptanceCriteria: ['O usuario deve conseguir fazer login informando email e senha'],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(0);
      expect(result.uncoveredCriteria).toHaveLength(1);
    });

    it('returns uncoveredCriteria when no match', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', ['Login simples'])];
      const criterion = 'O sistema deve enviar email de confirmacao apos cadastro';

      const result = service.selectByCriteria({
        acceptanceCriteria: [criterion],
        catalogItems: items,
      });

      expect(result.uncoveredCriteria).toEqual([criterion]);
      expect(result.warnings).toHaveLength(0);
    });

    it('maps multiple criteria to different scenarios', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Login', ['usuario preenche email senha login sistema']),
        makeCatalogItem('SCN-002', 'Logout', ['usuario autenticado clica botao sair sessao encerrada redirecionado login']),
      ];

      const result = service.selectByCriteria({
        acceptanceCriteria: [
          'usuario preenche email senha login sistema',
          'usuario autenticado clica botao sair sessao encerrada redirecionado login',
        ],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(2);
      expect(result.uncoveredCriteria).toHaveLength(0);
    });

    it('deduplicates when one scenario covers multiple criteria', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-001', 'Login', [
          'usuario preenche email senha login sistema',
          'sistema valida credenciais usuario login',
        ]),
      ];

      const result = service.selectByCriteria({
        acceptanceCriteria: [
          'usuario preenche email senha login sistema',
          'sistema valida credenciais usuario login',
        ],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(1);
      expect(result.coverageMetadata).toHaveLength(2);
      expect(result.selectedItems[0].id).toBe('SCN-001');
    });

    it('returns warning when acceptanceCriteria is empty', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', ['Login simples'])];

      const result = service.selectByCriteria({ acceptanceCriteria: [], catalogItems: items });

      expect(result.selectedItems).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('No acceptance criteria'))).toBe(true);
    });

    it('ignores items without criteria', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Generic', undefined)];

      const result = service.selectByCriteria({
        acceptanceCriteria: ['Qualquer criterio'],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(0);
      expect(result.uncoveredCriteria).toHaveLength(1);
    });

    it('preserves original catalog order', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [
        makeCatalogItem('SCN-002', 'Dashboard', ['usuario visualiza dashboard metricas graficos']),
        makeCatalogItem('SCN-001', 'Login', ['usuario preenche email senha login sistema']),
      ];

      const result = service.selectByCriteria({
        acceptanceCriteria: [
          'usuario preenche email senha login sistema',
          'usuario visualiza dashboard metricas graficos',
        ],
        catalogItems: items,
      });

      expect(result.selectedItems.map((i) => i.id)).toEqual(['SCN-002', 'SCN-001']);
    });

    it('is case and accent insensitive', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', ['Usuário autentica email senha login'])];

      const result = service.selectByCriteria({
        acceptanceCriteria: ['usuario autentica email senha login'],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(1);
    });

    it('returns low score below threshold when overlap is weak', () => {
      const service = new ScenarioSelectorService(createMockMemorySearch({ chunks: [], warnings: [] }));
      const items = [makeCatalogItem('SCN-001', 'Login', ['Usuario faz login com email'])];
      const criterion = 'O sistema deve enviar notificacao push quando pedido for concluido';

      const result = service.selectByCriteria({
        acceptanceCriteria: [criterion],
        catalogItems: items,
      });

      expect(result.selectedItems).toHaveLength(0);
      expect(result.uncoveredCriteria).toEqual([criterion]);
    });
  });
});
