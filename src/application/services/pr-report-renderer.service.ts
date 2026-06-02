import { Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { QaValueMetrics } from '../../domain/schemas/qa-value-metrics.schema.js';
import type { AcceptanceCriterionCoverage } from './acceptance-criteria-coverage.mapper.js';
import type { EvidenceLink } from './evidence-link.mapper.js';
import { sortEvidenceLinks } from './evidence-link.mapper.js';
import type { BlockItem } from './block-extractor.helper.js';

export interface PRPublicationStatus {
  published: boolean;
  fallback: boolean;
  reason?: string;
}

export interface PRReportInput {
  result: QaRunResult;
  config: RunConfig;
  repository: string;
  pullNumber: number;
  commitSha?: string;
  headRef?: string;
  baseRef?: string;
  coverageMap?: AcceptanceCriterionCoverage[];
  uncoveredCriteria?: string[];
  evidenceMap?: {
    byBugId?: Record<string, EvidenceLink[]>;
    byScenarioId?: Record<string, EvidenceLink[]>;
    video?: EvidenceLink[];
    trace?: EvidenceLink[];
  };
  blocks?: BlockItem[];
  publicationStatus?: PRPublicationStatus;
  qaValueMetrics?: QaValueMetrics;
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
      ...this.renderValueMetrics(input),
      ...this.renderAcceptanceCriteria(input),
      ...this.renderCoveredCriteria(input),
      ...this.renderUncoveredCriteria(input),
      ...this.renderScenarios(input),
      ...this.renderBlocks(input),
      ...this.renderBugs(input),
      ...this.renderWarnings(input),
      ...this.renderPublicationStatus(input),
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

  private renderValueMetrics(input: PRReportInput): string[] {
    const m = input.qaValueMetrics;
    if (!m) return [];
    const lines: string[] = ['', '## QA Value'];
    lines.push(`- Manual QA estimate: ${m.estimatedManualMinutes} min`);
    lines.push(`- Agent execution time: ${m.agentExecutionMinutes} min`);
    lines.push(`- Estimated time saved: ${m.estimatedMinutesSaved} min`);
    lines.push(`- Scenarios executed: ${m.scenariosExecuted}`);
    lines.push(`- Acceptance criteria covered: ${m.acceptanceCriteriaCovered}/${m.acceptanceCriteriaTotal}`);
    lines.push(`- Bugs found: ${m.bugsFound}`);
    if (m.evidenceFilesGenerated) lines.push(`- Evidence files generated: ${m.evidenceFilesGenerated}`);
    return lines;
  }

  private renderAcceptanceCriteria(input: PRReportInput): string[] {
    const criteria = input.config.demand.acceptanceCriteria ?? [];
    if (!criteria.length) return [];
    const lines: string[] = ['', '## Acceptance Criteria'];
    for (const c of criteria) lines.push(`- ${c}`);
    return lines;
  }

  private hasAcceptanceCriteria(input: PRReportInput): boolean {
    return (input.config.demand.acceptanceCriteria ?? []).length > 0;
  }

  private renderCoveredCriteria(input: PRReportInput): string[] {
    if (!this.hasAcceptanceCriteria(input)) return [];
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

  private renderUncoveredCriteria(input: PRReportInput): string[] {
    if (!this.hasAcceptanceCriteria(input)) return [];
    const uncovered = input.uncoveredCriteria ?? [];
    if (!uncovered.length) return [];
    const lines: string[] = ['', '## Uncovered Acceptance Criteria'];
    lines.push('', '⚠️ The following acceptance criteria were not covered by any executed scenario:');
    for (const c of uncovered) {
      lines.push(`- ${sanitizeTableCell(c)}`);
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

  private renderBlocks(input: PRReportInput): string[] {
    const blocks = input.blocks ?? [];
    if (!blocks.length) return [];
    const lines: string[] = ['', '## Blocks'];
    lines.push('', '| Source | Scenario | Task | Step | Code | Reason |', '|---|---|---|---|---|---|');
    for (const b of blocks) {
      lines.push(
        `| ${sanitizeTableCell(b.source)} | ${sanitizeTableCell(b.scenarioId ?? '—')} | ${sanitizeTableCell(b.taskId ?? '—')} | ${sanitizeTableCell(b.stepId ?? '—')} | ${sanitizeTableCell(b.code ?? '—')} | ${sanitizeTableCell(b.reason)} |`,
      );
    }
    return lines;
  }

  private renderBugs(input: PRReportInput): string[] {
    const bugs = input.result.bugs ?? [];
    const lines: string[] = ['', '## Bugs'];
    if (!bugs.length) {
      lines.push('_No bugs were reported._');
      return lines;
    }
    for (const b of bugs) {
      const severity = b.classification?.severity ?? 'UNKNOWN';
      const category = b.classification?.category ?? 'UNCLASSIFIED';
      const reason = sanitizeTableCell(b.classification?.reason?.trim() || 'Bug found during QA execution');
      lines.push('', `- **${b.bugId}** — ${severity} — ${category} — ${reason}`);

      if (b.url) lines.push(`  - URL: \`${sanitizeTableCell(b.url)}\``);
      if (b.expected) lines.push(`  - Expected: ${sanitizeTableCell(b.expected)}`);
      if (b.actual) lines.push(`  - Actual: ${sanitizeTableCell(b.actual)}`);
      if (b.signalType) lines.push(`  - Signal: ${sanitizeTableCell(b.signalType)}`);
      if (b.scenarioId) lines.push(`  - Scenario: \`${sanitizeTableCell(b.scenarioId)}\``);
      if (b.taskId) lines.push(`  - Task: \`${sanitizeTableCell(b.taskId)}\``);
      if (b.stepId) lines.push(`  - Step: \`${sanitizeTableCell(b.stepId)}\``);

      const evidenceLinks = input.evidenceMap?.byBugId?.[b.bugId] ?? [];
      if (evidenceLinks.length) {
        for (const link of sortEvidenceLinks(evidenceLinks)) {
          lines.push(`  - ${link.label}: \`${link.path}\``);
        }
      }
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

  private renderPublicationStatus(input: PRReportInput): string[] {
    const status = input.publicationStatus;
    if (!status) return [];
    const lines: string[] = ['', '## PR Publication Status', ''];
    lines.push(`- **Published to PR:** ${status.published ? 'yes' : 'no'}`);
    lines.push(`- **Fallback local:** ${status.fallback ? 'yes' : 'no'}`);
    if (status.reason) {
      lines.push(`- **Reason:** ${sanitizeTableCell(status.reason)}`);
    }
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
    for (const link of input.evidenceMap?.video ?? []) lines.push(`- ${link.label}: \`${link.path}\``);
    for (const link of input.evidenceMap?.trace ?? []) lines.push(`- ${link.label}: \`${link.path}\``);
    return lines;
  }
}
