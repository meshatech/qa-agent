import { Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { AcceptanceCriterionCoverage } from './acceptance-criteria-coverage.mapper.js';

export interface PRReportInput {
  result: QaRunResult;
  config: RunConfig;
  repository: string;
  pullNumber: number;
  commitSha?: string;
  headRef?: string;
  baseRef?: string;
  coverageMap?: AcceptanceCriterionCoverage[];
}

function extractWarnings(result: QaRunResult): Array<{ stepId?: string; message?: string }> {
  const planRuntime = (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime;
  return Array.isArray(planRuntime?.warnings)
    ? (planRuntime.warnings as Array<{ stepId?: string; message?: string }>)
    : [];
}

function formatStatus(status?: string): string {
  if (!status) return 'UNKNOWN';
  const normalized = status.toLowerCase().trim().replace(/_/g, '');
  switch (normalized) {
    case 'pass':
    case 'passed': return 'PASSED';
    case 'passedwithwarnings': return 'PASSED_WITH_WARNINGS';
    case 'fail':
    case 'failed': return 'FAILED';
    case 'block':
    case 'blocked': return 'BLOCKED';
    case 'skip':
    case 'skipped': return 'SKIPPED';
    case 'partial': return 'PARTIAL';
    case 'running': return 'RUNNING';
    case 'planned': return 'PLANNED';
    default: return status.toUpperCase();
  }
}

function sanitizeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

@Injectable()
export class PRReportRenderer {
  render(input: PRReportInput): string {
    const lines: string[] = [
      ...this.renderHeader(input),
      ...this.renderSummary(input),
      ...this.renderAcceptanceCriteria(input),
      ...this.renderCoveredCriteria(input),
      ...this.renderScenarios(input),
      ...this.renderBugs(input),
      ...this.renderWarnings(input),
      ...this.renderArtifacts(input),
    ];
    return lines.join('\n');
  }

  private renderHeader(input: PRReportInput): string[] {
    const { result, repository, pullNumber, commitSha, headRef, baseRef } = input;
    const lines = [
      '# QA Agent — PR Report',
      '',
      `**Status:** ${result.status}`,
      `**Repository:** ${repository}`,
      `**Pull Request:** #${pullNumber}`,
    ];
    if (commitSha) lines.push(`**Commit:** ${commitSha}`);
    if (baseRef) lines.push(`**Base:** ${baseRef}`);
    if (headRef) lines.push(`**Head:** ${headRef}`);
    return lines;
  }

  private renderSummary(input: PRReportInput): string[] {
    const { result } = input;
    const m = result.metrics;
    const scenarios = result.scenarios ?? [];
    const bugs = result.bugs ?? [];
    const warnings = extractWarnings(result);
    return [
      '',
      '## Summary',
      '',
      `- Scenarios: ${m?.totalScenarios ?? scenarios.length}`,
      `- Passed: ${m?.passedScenarios ?? scenarios.filter((s) => s.status === 'PASSED').length}`,
      `- Failed: ${m?.failedScenarios ?? scenarios.filter((s) => s.status === 'FAILED').length}`,
      `- Blocked: ${m?.blockedScenarios ?? scenarios.filter((s) => s.status === 'BLOCKED' || s.status === 'PARTIAL').length}`,
      `- Bugs: ${m?.totalBugs ?? bugs.length}`,
      `- Warnings: ${warnings.length}`,
    ];
  }

  private renderAcceptanceCriteria(input: PRReportInput): string[] {
    const criteria = input.config.demand.acceptanceCriteria ?? [];
    if (!criteria.length) return [];
    const lines: string[] = ['', '## Acceptance Criteria'];
    for (const c of criteria) lines.push(`- ${c}`);
    return lines;
  }

  private renderCoveredCriteria(input: PRReportInput): string[] {
    const hasCriteria = (input.config.demand.acceptanceCriteria ?? []).length > 0;
    if (!hasCriteria) return [];
    const coverageMap = input.coverageMap ?? [];
    const lines: string[] = ['', '## Covered Acceptance Criteria'];
    if (!coverageMap.length) {
      lines.push('_No acceptance criteria were mapped to executed scenarios._');
      return lines;
    }
    lines.push('', '| Acceptance Criterion | Covered By Scenario | Source | Score |', '|---|---|---|---|');
    for (const c of coverageMap) {
      const criterion = sanitizeTableCell(c.criterion);
      const scenarioTitle = sanitizeTableCell(c.scenarioTitle);
      lines.push(`| ${criterion} | ${scenarioTitle} | ${c.source} | ${c.score.toFixed(2)} |`);
    }
    return lines;
  }

  private renderScenarios(input: PRReportInput): string[] {
    const scenarios = input.result.scenarios ?? [];
    const lines: string[] = ['', '## Scenarios'];
    if (!scenarios.length) {
      lines.push('', '_No scenarios were reported._');
      return lines;
    }

    lines.push('', '| Scenario | Status | Tasks |', '|----------|--------|-------|');
    for (const s of scenarios) {
      const taskCount = s.tasks?.length ?? 0;
      const scenarioTitle = sanitizeTableCell(s.title || s.id || 'Untitled scenario');
      lines.push(`| ${scenarioTitle} | ${formatStatus(s.status)} | ${taskCount} |`);
    }

    for (const s of scenarios) {
      const scenarioTitle = s.title || s.id || 'Untitled scenario';
      lines.push('', `### ${scenarioTitle}`);
      const tasks = s.tasks ?? [];
      if (!tasks.length) {
        lines.push('_No tasks reported for this scenario._');
        continue;
      }
      for (const t of tasks) {
        const taskId = t.id || '—';
        const taskStatus = formatStatus(t.status);
        const taskTitle = t.title || t.expected || 'Untitled task';
        lines.push(`- ${taskId} — ${taskStatus} — ${taskTitle}`);
      }
    }

    return lines;
  }

  private renderBugs(input: PRReportInput): string[] {
    const bugs = input.result.bugs ?? [];
    if (!bugs.length) return [];
    const lines: string[] = ['', '## Bugs'];
    for (const b of bugs) {
      const evidencePath = b.path ? `Evidence: \`${b.path}/bug-report.md\`` : '';
      lines.push('', `- **${b.bugId}** — ${b.classification.severity} — ${b.classification.reason}`, evidencePath);
    }
    return lines;
  }

  private renderWarnings(input: PRReportInput): string[] {
    const warnings = extractWarnings(input.result);
    if (!warnings.length) return [];
    const lines: string[] = ['', '## Warnings'];
    for (const w of warnings) lines.push(`- ${w.stepId ?? 'runtime'}: ${w.message ?? 'warning'}`);
    return lines;
  }

  private renderArtifacts(input: PRReportInput): string[] {
    const { result } = input;
    const lines = [
      '',
      '## Artifacts',
      '',
      '- Execution report: `execution-report.md`',
      '- Execution log: `execution-log.json`',
      '- Run data: `run.json`',
      '- Metrics: `metrics.json`',
      '- Selected scenarios: `selected-scenarios.md`',
      '- Execution plan: `execution-plan.json`',
    ];
    if (result.runDir) lines.push(`- Run directory: \`${result.runDir}\``);
    return lines;
  }
}
