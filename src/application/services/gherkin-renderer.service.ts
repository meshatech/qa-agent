import { Injectable } from '@nestjs/common';
import type { SelectedScenariosArtifact } from '../../domain/schemas/selected-scenarios-artifact.schema.js';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';

type ScenarioIntent = 'auth' | 'login' | 'logout' | 'menu' | 'theme' | 'appearance' | 'generic';

@Injectable()
export class GherkinRendererService {
  renderMarkdown(artifact: SelectedScenariosArtifact): string {
    const lines: string[] = [];
    lines.push('# Cenários Selecionados');
    lines.push('');
    lines.push(`**Gerado em:** ${artifact.generatedAt}`);
    lines.push(`**Fonte:** ${artifact.source}`);
    lines.push(`**Total:** ${artifact.summary.total}`);
    lines.push(`**Selecionados:** ${artifact.summary.selected}`);
    lines.push(`**Gerados:** ${artifact.summary.generated}`);
    lines.push(`**Não cobertos:** ${artifact.summary.uncovered}`);
    lines.push(`**Limite aplicado:** ${artifact.summary.truncated ? 'sim' : 'não'}`);
    lines.push(`**Max scenarios:** ${artifact.summary.maxScenarios}`);
    lines.push('');

    if (artifact.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const warning of artifact.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push('');
    }

    lines.push('## Cenários');
    lines.push('');

    const allScenarios = artifact.scenarios;
    const selectedIds = new Set(artifact.selected.map((s) => s.id));
    const generatedIds = new Set(artifact.generated.map((s) => s.id));
    let index = 1;
    for (const scenario of allScenarios) {
      const origin = this.resolveOrigin(scenario, selectedIds, generatedIds);
      lines.push(...this.renderScenarioSection(scenario, origin, index));
      index++;
    }

    return lines.join('\n');
  }

  private resolveOrigin(scenario: QaScenario, selectedIds: Set<string>, generatedIds: Set<string>): string {
    if (selectedIds.has(scenario.id)) return 'selected';
    if (generatedIds.has(scenario.id)) return 'generated';
    return 'desconhecida';
  }

  private renderScenarioSection(scenario: QaScenario, origin: string, index: number): string[] {
    const lines: string[] = [];
    lines.push(`### ${index}. ${scenario.title}`);
    lines.push('');
    lines.push(`**Origem:** ${origin}`);
    lines.push('');

    const gherkin = this.renderGherkinBlock(scenario);
    lines.push('```gherkin');
    lines.push(gherkin);
    lines.push('```');
    lines.push('');

    return lines;
  }

  private renderGherkinBlock(scenario: QaScenario): string {
    const intent = this.detectIntent(scenario);
    const steps = this.renderSteps(scenario, intent);

    const lines: string[] = [];
    lines.push(`Feature: ${this.sanitizeLine(scenario.title)}`);
    lines.push('');
    lines.push(`Scenario: ${this.sanitizeLine(scenario.title)}`);
    for (const step of steps) {
      lines.push(`  ${step}`);
    }

    return lines.join('\n');
  }

  private detectIntent(scenario: QaScenario): ScenarioIntent {
    const text = `${scenario.id} ${scenario.title} ${scenario.intent ?? ''}`.toLowerCase();
    if (text.includes('login') || text.includes('auth')) return 'auth';
    if (text.includes('logout') || text.includes('sair')) return 'logout';
    if (text.includes('menu')) return 'menu';
    if (text.includes('theme') || text.includes('tema') || text.includes('appearance') || text.includes('aparência')) return 'theme';
    return 'generic';
  }

  private renderSteps(scenario: QaScenario, intent: ScenarioIntent): string[] {
    switch (intent) {
      case 'auth':
      case 'login':
        return this.authTemplate(scenario);
      case 'logout':
        return this.logoutTemplate(scenario);
      case 'menu':
        return this.menuTemplate(scenario);
      case 'theme':
      case 'appearance':
        return this.themeTemplate(scenario);
      default:
        return this.fallbackTemplate(scenario);
    }
  }

  private authTemplate(scenario: QaScenario): string[] {
    return [
      'Given que o usuário está na tela de login',
      `When informa credenciais válidas${this.maybeTaskRef(scenario)}`,
      this.thenFromExpected(scenario, 'deve acessar a área autenticada'),
    ];
  }

  private logoutTemplate(scenario: QaScenario): string[] {
    return [
      'Given que o usuário está autenticado',
      `When abre o menu da conta${this.maybeTaskRef(scenario)}`,
      'And seleciona a opção de sair',
      this.thenFromExpected(scenario, 'deve retornar para a tela de login'),
      'And a sessão deve ser encerrada',
    ];
  }

  private menuTemplate(scenario: QaScenario): string[] {
    return [
      'Given que o usuário está autenticado',
      `When abre o menu relacionado${this.maybeTaskRef(scenario)}`,
      this.thenFromExpected(scenario, 'as opções esperadas devem estar visíveis'),
    ];
  }

  private themeTemplate(scenario: QaScenario): string[] {
    return [
      'Given que o usuário está autenticado',
      `When altera a aparência/tema${this.maybeTaskRef(scenario)}`,
      this.thenFromExpected(scenario, 'o estado visual da aplicação deve mudar de forma observável'),
    ];
  }

  private fallbackTemplate(scenario: QaScenario): string[] {
    const steps: string[] = [];

    if (scenario.preconditions && scenario.preconditions.length > 0) {
      let first = true;
      for (const pre of scenario.preconditions) {
        steps.push(`${first ? 'Given' : 'And'} ${this.sanitizeLine(pre)}`);
        first = false;
      }
    } else {
      steps.push('Given que o contexto do cenário está preparado');
    }

    const tasks = scenario.tasks ?? [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const keyword = this.keywordForTaskPosition(i, tasks.length);
      steps.push(`${keyword} ${this.sanitizeLine(task.title)}`);
    }

    const lastExpected = this.lastTaskExpected(tasks);
    if (lastExpected) {
      steps.push(`Then ${this.sanitizeLine(lastExpected)}`);
    } else {
      steps.push('Then o comportamento esperado deve ser observado');
    }

    return steps;
  }

  private keywordForTaskPosition(index: number, _total: number): string {
    if (index === 0) return 'When';
    return 'And';
  }

  private lastTaskExpected(tasks: QaTask[]): string | undefined {
    for (let i = tasks.length - 1; i >= 0; i--) {
      const exp = tasks[i].expected?.trim();
      if (exp && exp.length > 0) return exp;
    }
    return undefined;
  }

  private thenFromExpected(scenario: QaScenario, fallback: string): string {
    const expected = this.lastTaskExpected(scenario.tasks ?? []);
    return `Then ${this.sanitizeLine(expected ?? fallback)}`;
  }

  private maybeTaskRef(scenario: QaScenario): string {
    const tasks = scenario.tasks ?? [];
    if (tasks.length > 0 && tasks[0].id) {
      return ` (ref: ${tasks[0].id})`;
    }
    return '';
  }

  private sanitizeLine(text: string): string {
    return text
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/`/g, "'")
      .trim();
  }
}
