import { describe, expect, it } from 'vitest';

import { ScenarioSelectorService } from '../src/application/services/scenario-selector.service.js';
import type { MemoryChunk } from '../src/domain/schemas/memory.schema.js';
import type { RequiredScenario } from '../src/domain/schemas/correlation.schema.js';

describe('ScenarioSelectorService', () => {
  const service = new ScenarioSelectorService();

  function makeChunk(id: string, title: string, content: string, metadata?: Record<string, unknown>): MemoryChunk {
    return { id, type: 'scenario', title, content, sourceFile: '.agent-qa/memory.md', metadata };
  }

  function makeRequired(id: string, title: string, rationale: string): RequiredScenario {
    return { id, title, intent: 'POSITIVE', rationale, relatedFiles: [], riskScore: 0.5 };
  }

  it('selects scenario when title and content overlap with RequiredScenario', () => {
    const chunks = [
      makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuario preenche email e senha corretos para acessar area autenticada do sistema.'),
    ];
    const required = [makeRequired('REQ-001', 'Fluxo de login usuario', 'Validar que usuario consegue fazer login informando email e senha corretos para acessar area autenticada')];

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
    const required = [makeRequired('REQ-001', 'Logout', 'Usuário sai do sistema')];

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
    const required = [makeRequired('REQ-001', 'Logout do usuário', 'Encerrar sessão e redirecionar para login')];

    const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selectedScenarios).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('No scenario matched'))).toBe(true);
  });

  it('deduplicates by chunk id when multiple RequiredScenarios match the same chunk', () => {
    const chunks = [
      makeChunk('SCN-LOGIN-001', 'Login autenticado', 'Usuário preenche e-mail e senha, entra na área autenticada.'),
    ];
    const required = [
      makeRequired('REQ-001', 'Login com email', 'Validar login usando email e senha'),
      makeRequired('REQ-002', 'Área autenticada', 'Confirmar que usuário entra na área interna'),
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
      makeRequired('REQ-001', 'Login com credenciais validas', 'Usuario deve conseguir fazer login informando email e senha corretos para acessar area autenticada'),
      makeRequired('REQ-002', 'Encerrar sessao logout', 'Usuario autenticado deve conseguir sair do sistema e ser redirecionado para tela de login'),
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
    const required = [makeRequired('REQ-001', 'Login do usuario', 'Validar que usuario consegue fazer login informando email e senha corretos')];

    const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selectedScenarios.length).toBeLessThanOrEqual(10);
  });

  it('extracts intent from chunk metadata when present', () => {
    const chunks = [
      makeChunk('SCN-EDGE-001', 'Limite de tentativas login', 'Usuario digita senha errada repetidas vezes e o sistema bloqueia a conta temporariamente.', { intent: 'EDGE' }),
    ];
    const required = [makeRequired('REQ-001', 'Bloqueio por tentativas de login', 'Validar que sistema bloqueia conta quando usuario digita senha errada muitas vezes')];

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
      makeRequired('REQ-001', 'Login', 'Login do usuário'),
      makeRequired('REQ-002', 'Logout', 'Logout do usuário'),
    ];

    const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selectedScenarios.every((s) => s.intent === 'POSITIVE')).toBe(true);
  });

  it('truncates expected task content when chunk content is long', () => {
    const longContent = 'a'.repeat(500);
    const chunks = [makeChunk('SCN-001', 'Teste', longContent)];
    const required = [makeRequired('REQ-001', 'Teste', 'Teste qualquer')];

    const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selectedScenarios[0].tasks[0].expected).toHaveLength(200);
    expect(result.selectedScenarios[0].tasks[0].expected.endsWith('...')).toBe(true);
  });

  it('ignores short tokens but preserves content words in scoring', () => {
    const chunks = [makeChunk('SCN-001', 'Login page', 'The user can login with email and password.')];
    const required = [makeRequired('REQ-001', 'Login user email password', 'User logs in with email and password')];

    const result = service.select({ requiredScenarios: required, scenarioChunks: chunks });

    expect(result.selectedScenarios.length).toBeGreaterThan(0);
  });
});
