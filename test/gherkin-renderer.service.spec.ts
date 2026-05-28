import { describe, expect, it } from 'vitest';
import { GherkinRendererService } from '../src/application/services/gherkin-renderer.service.js';
import type { SelectedScenariosArtifact } from '../src/domain/schemas/selected-scenarios-artifact.schema.js';
import type { QaScenario } from '../src/domain/models/run.model.js';

function makeArtifact(scenarios: QaScenario[], warnings: string[] = []): SelectedScenariosArtifact {
  return {
    version: 1,
    generatedAt: '2026-05-28T10:00:00.000Z',
    source: 'scenario-orchestrator',
    scenarios,
    selected: scenarios,
    generated: [],
    uncoveredRequiredScenarios: [],
    warnings,
    summary: {
      total: scenarios.length,
      selected: scenarios.length,
      generated: 0,
      uncovered: 0,
      truncated: false,
      maxScenarios: 5,
    },
  };
}

function makeScenario(id: string, title: string, intent: string | undefined, tasks: QaScenario['tasks'], preconditions?: string[]): QaScenario {
  return { id, title, tasks, status: 'PLANNED', intent: intent as unknown as QaScenario['intent'], preconditions };
}

describe('GherkinRendererService', () => {
  const renderer = new GherkinRendererService();

  it('renders auth template for login title', () => {
    const scenario = makeScenario('SCN-001', 'Login do usuário', undefined, [
      { id: 'T001', title: 'Preencher email e senha', expected: 'Usuario logado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Feature: Login do usuário');
    expect(md).toContain('Scenario: Login do usuário');
    expect(md).toContain('Given que o usuário está na tela de login');
    expect(md).toContain('When informa credenciais válidas');
    expect(md).toContain('Then Usuario logado');
    expect(md).toContain('```gherkin');
  });

  it('renders logout template', () => {
    const scenario = makeScenario('SCN-002', 'Logout do sistema', undefined, [
      { id: 'T002', title: 'Sair da conta', expected: 'Usuario deslogado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Given que o usuário está autenticado');
    expect(md).toContain('When abre o menu da conta');
    expect(md).toContain('And seleciona a opção de sair');
    expect(md).toContain('Then Usuario deslogado');
    expect(md).toContain('And a sessão deve ser encerrada');
  });

  it('renders menu template', () => {
    const scenario = makeScenario('SCN-003', 'Abrir menu principal', undefined, [
      { id: 'T003', title: 'Clicar no menu', expected: 'Menu aberto', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Given que o usuário está autenticado');
    expect(md).toContain('When abre o menu relacionado');
    expect(md).toContain('Then Menu aberto');
  });

  it('renders theme template', () => {
    const scenario = makeScenario('SCN-004', 'Alterar tema', undefined, [
      { id: 'T004', title: 'Alterar tema', expected: 'Tema alterado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('When altera a aparência/tema');
    expect(md).toContain('Then Tema alterado');
  });

  it('uses fallback positional mapping for generic scenario', () => {
    const scenario = makeScenario('SCN-005', 'Cenário genérico', undefined, [
      { id: 'T005', title: 'Primeira ação', expected: 'Primeiro resultado', status: 'PENDING' },
      { id: 'T006', title: 'Segunda ação', expected: 'Segundo resultado', status: 'PENDING' },
      { id: 'T007', title: 'Terceira ação', expected: 'Terceiro resultado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Given que o contexto do cenário está preparado');
    expect(md).toContain('When Primeira ação');
    expect(md).toContain('And Segunda ação');
    expect(md).toContain('And Terceira ação');
    expect(md).toContain('Then Terceiro resultado');
  });

  it('renders preconditions as Given/And in fallback', () => {
    const scenario = makeScenario('SCN-006', 'Cenário com precondições', undefined, [
      { id: 'T008', title: 'Executar ação', expected: 'Resultado', status: 'PENDING' },
    ], ['Usuário está logado', 'Página de configurações está aberta']);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Given Usuário está logado');
    expect(md).toContain('And Página de configurações está aberta');
    expect(md).toContain('When Executar ação');
    expect(md).toContain('Then Resultado');
  });

  it('renders summary and warnings in markdown', () => {
    const scenario = makeScenario('SCN-007', 'Cenário simples', undefined, [
      { id: 'T009', title: 'Ação', expected: 'Esperado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario], ['Warning 1', 'Warning 2']);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('# Cenários Selecionados');
    expect(md).toContain('**Total:** 1');
    expect(md).toContain('**Selecionados:** 1');
    expect(md).toContain('## Warnings');
    expect(md).toContain('- Warning 1');
    expect(md).toContain('- Warning 2');
    expect(md).toContain('## Cenários');
  });

  it('sanitizes multi-line task titles', () => {
    const scenario = makeScenario('SCN-008', 'Título com quebra', undefined, [
      { id: 'T010', title: 'Primeira linha\nSegunda linha', expected: 'Resultado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('When Primeira linha Segunda linha');
    expect(md).not.toContain('Primeira linha\nSegunda linha');
  });

  it('detects intent from title when intent field is absent', () => {
    const scenario = makeScenario('SCN-009', 'Fluxo de login', undefined, [
      { id: 'T011', title: 'Ação', expected: 'Resultado', status: 'PENDING' },
    ]);
    const artifact = makeArtifact([scenario]);
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('Given que o usuário está na tela de login');
    expect(md).toContain('When informa credenciais válidas');
  });

  it('marks origin as generated when in generated list', () => {
    const selected: QaScenario[] = [];
    const generated: QaScenario[] = [
      makeScenario('SCN-010', 'Gerado automaticamente', undefined, [
        { id: 'T012', title: 'Ação', expected: 'Resultado', status: 'PENDING' },
      ]),
    ];
    const artifact: SelectedScenariosArtifact = {
      version: 1,
      generatedAt: '2026-05-28T10:00:00.000Z',
      source: 'scenario-orchestrator',
      scenarios: generated,
      selected,
      generated,
      uncoveredRequiredScenarios: [],
      warnings: [],
      summary: { total: 1, selected: 0, generated: 1, uncovered: 0, truncated: false, maxScenarios: 5 },
    };
    const md = renderer.renderMarkdown(artifact);

    expect(md).toContain('**Origem:** generated');
  });
});
