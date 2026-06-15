import { Injectable } from '@nestjs/common';
import type { QaScenario, QaTask } from '../../domain/models/run.model.js';

export interface GherkinFeatureInput {
  scenarios: QaScenario[];
  featureTitle?: string;
}

@Injectable()
export class GherkinFeatureRendererService {
  renderFeatureFile(input: GherkinFeatureInput, scenarioId: string): string | undefined {
    const scenario = input.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return undefined;

    const lines: string[] = [];
    lines.push('# language: pt');
    lines.push('');

    const tag = this.statusTag(scenario.status);
    if (tag) lines.push(tag);

    lines.push(`Funcionalidade: ${this.sanitizeLine(input.featureTitle ?? scenario.title)}`);
    lines.push('');

    lines.push(...this.renderScenario(scenario));

    return lines.join('\n');
  }

  renderAllFeatures(input: GherkinFeatureInput): Record<string, string> {
    const result: Record<string, string> = {};
    for (const scenario of input.scenarios) {
      const content = this.renderFeatureFile(input, scenario.id);
      if (content) result[scenario.id] = content;
    }
    return result;
  }

  renderScenarioBlock(scenario: QaScenario): string {
    return this.renderScenario(scenario).join('\n');
  }

  private renderScenario(scenario: QaScenario): string[] {
    const lines: string[] = [];

    lines.push(`  Cenário: ${this.sanitizeLine(scenario.title)}`);

    // Preconditions → Dado
    if (scenario.preconditions && scenario.preconditions.length > 0) {
      let first = true;
      for (const pre of scenario.preconditions) {
        lines.push(`    ${first ? 'Dado' : 'E'} ${this.sanitizeLine(pre)}`);
        first = false;
      }
    }

    // Tasks → Quando / E
    const tasks = scenario.tasks ?? [];
    for (let i = 0; i < tasks.length; i++) {
      const keyword = i === 0 ? 'Quando' : 'E';
      lines.push(`    ${keyword} ${this.sanitizeLine(tasks[i].title)}`);
    }

    // Last expected → Então
    const lastExpected = this.lastTaskExpected(tasks);
    if (lastExpected) {
      lines.push(`    Então ${this.sanitizeLine(lastExpected)}`);
    }

    return lines;
  }

  private statusTag(status: QaScenario['status']): string | undefined {
    switch (status) {
      case 'PASSED':
      case 'PASSED_WITH_WARNINGS':
        return '@passed';
      case 'FAILED':
        return '@failed';
      case 'BLOCKED':
        return '@blocked';
      case 'PARTIAL':
        return '@partial';
      default:
        return undefined;
    }
  }

  private lastTaskExpected(tasks: QaTask[]): string | undefined {
    for (let i = tasks.length - 1; i >= 0; i--) {
      const exp = tasks[i].expected?.trim();
      if (exp && exp.length > 0) return exp;
    }
    return undefined;
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
