import { Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';

export interface PRReportInput {
  result: QaRunResult;
  repository: string;
  pullNumber: number;
  commitSha?: string;
  headRef?: string;
  baseRef?: string;
}

@Injectable()
export class PRReportRenderer {
  render(input: PRReportInput): string {
    const { result, repository, pullNumber, commitSha, headRef, baseRef } = input;
    const m = result.metrics;
    const scenarios = result.scenarios ?? [];
    const bugs = result.bugs ?? [];
    const planRuntime = (result as QaRunResult & { planRuntime?: Record<string, unknown> }).planRuntime;
    const warnings = Array.isArray(planRuntime?.warnings)
      ? (planRuntime.warnings as Array<{ stepId?: string; message?: string }>)
      : [];

    const lines: string[] = [
      '# QA Agent — PR Report',
      '',
      `**Status:** ${result.status}`,
      `**Repository:** ${repository}`,
      `**Pull Request:** #${pullNumber}`,
    ];

    if (commitSha) lines.push(`**Commit:** ${commitSha}`);
    if (baseRef) lines.push(`**Base:** ${baseRef}`);
    if (headRef) lines.push(`**Head:** ${headRef}`);

    lines.push(
      '',
      '## Summary',
      '',
      `- Scenarios: ${m?.totalScenarios ?? scenarios.length}`,
      `- Passed: ${m?.passedScenarios ?? scenarios.filter((s) => s.status === 'PASSED').length}`,
      `- Failed: ${m?.failedScenarios ?? scenarios.filter((s) => s.status === 'FAILED').length}`,
      `- Blocked: ${m?.blockedScenarios ?? scenarios.filter((s) => s.status === 'BLOCKED' || s.status === 'PARTIAL').length}`,
      `- Bugs: ${m?.totalBugs ?? bugs.length}`,
      `- Warnings: ${warnings.length}`,
    );

    if (scenarios.length) {
      lines.push('', '## Scenarios', '', '| Scenario | Status |', '|----------|--------|');
      for (const s of scenarios) {
        lines.push(`| ${s.title} | ${s.status} |`);
      }
    }

    if (bugs.length) {
      lines.push('', '## Bugs');
      for (const b of bugs) {
        const evidencePath = b.path ? `Evidence: \`${b.path}/bug-report.md\`` : '';
        lines.push('', `- **${b.bugId}** — ${b.classification.severity} — ${b.classification.reason}`, evidencePath);
      }
    }

    if (warnings.length) {
      lines.push('', '## Warnings');
      for (const w of warnings) {
        lines.push(`- ${w.stepId ?? 'runtime'}: ${w.message ?? 'warning'}`);
      }
    }

    lines.push(
      '',
      '## Artifacts',
      '',
      '- Execution report: `execution-report.md`',
      '- Execution log: `execution-log.json`',
      '- Run data: `run.json`',
      '- Metrics: `metrics.json`',
      '- Selected scenarios: `selected-scenarios.md`',
      '- Execution plan: `execution-plan.json`',
    );

    if (result.runDir) {
      lines.push(`- Run directory: \`${result.runDir}\``);
    }

    return lines.join('\n');
  }
}
