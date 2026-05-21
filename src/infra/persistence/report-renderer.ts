import { Injectable } from '@nestjs/common';
import type { QaBug, QaRunResult, QaScenario, QaStep } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

export interface BugReportInput {
  bug: QaBug;
  step: QaStep;
  config: RunConfig;
  attempts?: Array<{ actionType: string; result: string; reason?: string; ts: string }>;
  consoleLogs?: string;
  promptVersion?: string;
  agentVersion?: string;
  runId?: string;
}

@Injectable()
export class ReportRenderer {
  renderBugReport(input: BugReportInput): string {
    const { bug, step } = input;
    const url = bug.url ?? '—';
    const expected = bug.expected ?? step.validation?.expected ?? step.boundExpected.type ?? '—';
    const actual = bug.actual ?? step.validation?.actual ?? '—';
    const signal = bug.signalType ?? 'ASSERTION_FAILURE';
    const attemptsTable = this.attemptsTable(input.attempts);
    return [
      `# ${bug.bugId} — ${this.title(bug)}`,
      '',
      '## Severidade',
      bug.classification.severity,
      '',
      '## Categoria',
      bug.classification.category,
      '',
      '## Cenário',
      bug.scenarioId ?? '—',
      '',
      '## Task',
      `${bug.taskId ?? '—'} — ${this.taskTitle(bug, input)}`,
      '',
      '## Step',
      bug.stepId,
      '',
      '## URL',
      url,
      '',
      '## Resultado esperado',
      expected,
      '',
      '## Resultado obtido',
      actual,
      '',
      '## Sinal',
      `${signal} — ${bug.classification.reason}`,
      '',
      '## Evidências',
      '- Screenshot: ./screenshot.png',
      '- Vídeo: ./video.webm',
      '- Trace: ./trace.zip',
      '- Console log: ./console.log',
      '- Network log: ./network.json',
      '- DOM snapshot: ./dom-snapshot.html',
      '- Observation: ./observation.json',
      '',
      '## Logs relevantes',
      '',
      '```txt',
      input.consoleLogs?.trim() || '(sem logs relevantes)',
      '```',
      '',
      '## Tentativas anteriores',
      '',
      attemptsTable,
      '',
      '## Possível causa',
      '',
      this.maybeCause(bug),
      '',
      '## Metadados',
      '',
      `- runId: ${input.runId ?? '—'}`,
      `- timestamp: ${bug.capturedAt}`,
      `- agent version: ${input.agentVersion ?? input.config.agentVersion}`,
      `- prompt version: ${input.promptVersion ?? input.config.llm.promptVersion}`,
      '',
    ].join('\n');
  }

  renderExecutionReport(result: QaRunResult, config: RunConfig, runId?: string): string {
    const m = result.metrics;
    const startedAt = result.startedAt ?? '—';
    const finishedAt = result.finishedAt ?? '—';
    const durationMs = m?.totalDurationMs ?? 0;
    const planRuntime = (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime;
    return [
      `# Execution Report — Run ${runId ?? '—'}`,
      '',
      '## Resumo',
      '',
      `- Demanda: ${config.demand.title}`,
      `- Início: ${startedAt}`,
      `- Fim: ${finishedAt}`,
      `- Status: ${result.status}`,
      `- Duração: ${durationMs} ms`,
      '',
      '## Planner',
      '',
      `- Provider: ${String(planRuntime?.plannerProvider ?? config.llm.provider)}`,
      `- Model: ${String(planRuntime?.plannerModel ?? config.llm.model)}`,
      `- Plan source: ${String(planRuntime?.planSource ?? '—')}`,
      `- Plan version: ${String(planRuntime?.planVersion ?? '—')}`,
      `- Fallback reason: ${String(planRuntime?.fallbackReason ?? '—')}`,
      `- Fallback warning: ${String(planRuntime?.fallbackWarning ?? '—')}`,
      '',
      '## Métricas',
      '',
      '| Métrica | Valor |',
      '|---------|-------|',
      `| Cenários | ${m?.totalScenarios ?? 0} |`,
      `| Passaram | ${m?.passedScenarios ?? 0} |`,
      `| Falharam | ${m?.failedScenarios ?? 0} |`,
      `| Bloqueados | ${m?.blockedScenarios ?? 0} |`,
      `| Tasks total | ${m?.totalTasks ?? 0} |`,
      `| Tasks passadas | ${m?.passedTasks ?? 0} |`,
      `| Tasks falhadas | ${m?.failedTasks ?? 0} |`,
      `| Tasks puladas | ${m?.skippedTasks ?? 0} |`,
      `| Steps total | ${m?.totalSteps ?? 0} |`,
      `| Bugs reais | ${m?.totalBugs ?? 0} |`,
      `| Bugs LOW | ${m?.bugsBySeverity.LOW ?? 0} |`,
      `| Bugs MEDIUM | ${m?.bugsBySeverity.MEDIUM ?? 0} |`,
      `| Bugs HIGH | ${m?.bugsBySeverity.HIGH ?? 0} |`,
      `| Bugs CRITICAL | ${m?.bugsBySeverity.CRITICAL ?? 0} |`,
      `| Chamadas LLM | ${m?.llmCalls ?? 0} |`,
      '',
      '## Cenários',
      '',
      this.renderScenarios(result.scenarios ?? []),
      '',
      '## Bugs encontrados',
      '',
      this.renderBugs(result.bugs ?? []),
      '',
      '## Warnings operacionais',
      '',
      this.renderWarnings(planRuntime?.warnings),
      '',
      '## Arquivos importantes',
      '',
      '- run.json',
      '- execution-plan.json',
      '- execution-log.json',
      '- run-data.json',
      '- metrics.json',
      '- config.json',
      '',
    ].join('\n');
  }

  private renderWarnings(warnings: unknown): string {
    if (!Array.isArray(warnings) || !warnings.length) return 'Nenhum warning operacional.';
    return warnings
      .map((warning) => {
        if (warning && typeof warning === 'object') {
          const item = warning as { stepId?: unknown; message?: unknown };
          return `- ${String(item.stepId ?? 'runtime')}: ${String(item.message ?? 'warning')}`;
        }
        return `- ${String(warning)}`;
      })
      .join('\n');
  }

  private renderScenarios(scenarios: QaScenario[]): string {
    if (!scenarios.length) return 'Nenhum cenário executado.';
    return scenarios
      .map((s) => {
        const passed = s.tasks.filter((t) => t.status === 'PASSED').length;
        const failed = s.tasks.filter((t) => t.status === 'FAILED').length;
        const blocked = s.tasks.filter((t) => t.status === 'BLOCKED').length;
        const skipped = s.tasks.filter((t) => t.status === 'SKIPPED').length;
        const tasks = s.tasks.map((t) => `- ${t.id} ${t.status}: ${t.title}${t.dependsOn?.length ? ` _(depende: ${t.dependsOn.join(', ')})_` : ''}`).join('\n');
        return `### ${s.title} — ${s.status}\n\n- Tasks passadas: ${passed}\n- Tasks falhadas: ${failed}\n- Tasks bloqueadas: ${blocked}\n- Tasks puladas: ${skipped}\n\n${tasks}`;
      })
      .join('\n\n');
  }

  private renderBugs(bugs: QaBug[]): string {
    if (!bugs.length) return 'Nenhum bug.';
    return bugs.map((b) => `- [${b.bugId}](${b.path}/bug-report.md) — ${b.classification.severity} — ${b.classification.reason}`).join('\n');
  }

  private attemptsTable(attempts?: BugReportInput['attempts']): string {
    if (!attempts || !attempts.length) return '_(sem tentativas registradas)_';
    const header = '| Ação | Resultado | Motivo | Timestamp |\n|------|-----------|--------|-----------|';
    const rows = attempts.map((a) => `| ${a.actionType} | ${a.result} | ${a.reason ?? ''} | ${a.ts} |`).join('\n');
    return `${header}\n${rows}`;
  }

  private title(bug: QaBug): string {
    return bug.classification.reason.slice(0, 100);
  }

  private taskTitle(bug: QaBug, input: BugReportInput): string {
    void bug;
    return input.step.action.type;
  }

  private maybeCause(bug: QaBug): string {
    if (bug.classification.category === 'APP_FAULT' && bug.classification.severity === 'CRITICAL') return 'Falha do backend ou exceção não tratada na aplicação.';
    if (bug.classification.category === 'NAVIGATION_FAULT') return 'Redirecionamento inesperado ou rota inválida.';
    if (bug.classification.category === 'ASSERTION_FAULT') return 'Comportamento esperado pelo cenário não ocorreu.';
    return 'Sem hipótese definida — investigar evidências.';
  }
}
