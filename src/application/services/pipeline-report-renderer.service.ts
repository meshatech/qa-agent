import { Injectable } from '@nestjs/common';

export interface PipelineReportInput {
  demandId?: string;
  demandTitle?: string;
  preflightStatus?: string;
  changedFilesCount?: number;
  requiredScenariosCount?: number;
  selectedScenariosCount?: number;
  executionPlanSteps?: number;
  executionOk?: boolean;
  stepsExecuted?: number;
  stepsPassed?: number;
  stepsFailed?: number;
  warningsCount?: number;
  locatorTelemetrySummary?: {
    deterministicResolutions: number;
    semanticFallbacks: number;
    llmDecides: number;
    replans: number;
    targetsNotFound: number;
  };
  warnings?: Array<{ stepId: string; message: string }>;
  fallbackReason?: string;
  executionPlanPath?: string;
  executionResultPath?: string;
}

@Injectable()
export class PipelineReportRenderer {
  render(input: PipelineReportInput): string {
    const lines: string[] = [
      ...this.renderHeader(input),
      ...this.renderPipelineSteps(input),
      ...this.renderExecutionSummary(input),
      ...this.renderLocatorTelemetry(input),
      ...this.renderWarnings(input),
      ...this.renderArtifacts(input),
    ];
    return lines.join('\n');
  }

  private renderHeader(input: PipelineReportInput): string[] {
    const lines = [
      '# QA Agent — Pipeline Report',
      '',
      `**Demand:** ${input.demandId ?? 'N/A'} — ${input.demandTitle ?? 'N/A'}`,
      `**Pipeline Status:** ${input.executionOk === false ? 'FAILED' : 'COMPLETED'}`,
    ];
    if (input.preflightStatus) {
      lines.push(`**Preflight:** ${input.preflightStatus}`);
    }
    return lines;
  }

  private renderPipelineSteps(input: PipelineReportInput): string[] {
    const lines = [
      '',
      '## Pipeline Steps',
      '',
      '| Step | Status | Count |',
      '|------|--------|-------|',
    ];

    if (input.changedFilesCount !== undefined) {
      lines.push(`| PR Diff Context | OK | ${input.changedFilesCount} changed files |`);
    }
    if (input.requiredScenariosCount !== undefined) {
      lines.push(`| Correlation | OK | ${input.requiredScenariosCount} required scenarios |`);
    }
    if (input.selectedScenariosCount !== undefined) {
      lines.push(`| Scenario Selection | OK | ${input.selectedScenariosCount} selected scenarios |`);
    }
    if (input.executionPlanSteps !== undefined) {
      lines.push(`| Plan Generation | OK | ${input.executionPlanSteps} plan steps |`);
    }
    if (input.stepsExecuted !== undefined) {
      const execStatus = input.executionOk ? 'PASSED' : 'FAILED';
      lines.push(`| Execution | ${execStatus} | ${input.stepsExecuted} steps executed |`);
    }

    return lines;
  }

  private renderExecutionSummary(input: PipelineReportInput): string[] {
    if (input.stepsExecuted === undefined) return [];
    return [
      '',
      '## Execution Summary',
      '',
      `- Steps executed: ${input.stepsExecuted}`,
      `- Steps passed: ${input.stepsPassed ?? 0}`,
      `- Steps failed: ${input.stepsFailed ?? 0}`,
      `- Warnings: ${input.warningsCount ?? 0}`,
    ];
  }

  private renderLocatorTelemetry(input: PipelineReportInput): string[] {
    const t = input.locatorTelemetrySummary;
    if (!t) return [];
    return [
      '',
      '## Locator Telemetry',
      '',
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Deterministic resolutions | ${t.deterministicResolutions} |`,
      `| Semantic fallbacks | ${t.semanticFallbacks} |`,
      `| LLM decides | ${t.llmDecides} |`,
      `| Replans | ${t.replans} |`,
      `| Targets not found | ${t.targetsNotFound} |`,
    ];
  }

  private renderWarnings(input: PipelineReportInput): string[] {
    const warnings = input.warnings ?? [];
    if (!warnings.length) return [];
    const lines = [
      '',
      '## Warnings',
      '',
    ];
    for (const w of warnings) {
      lines.push(`- **${w.stepId}:** ${w.message}`);
    }
    return lines;
  }

  private renderArtifacts(input: PipelineReportInput): string[] {
    const lines = [
      '',
      '## Artifacts',
      '',
    ];
    if (input.executionPlanPath) lines.push(`- Execution plan: \`${input.executionPlanPath}\``);
    if (input.executionResultPath) lines.push(`- Execution result: \`${input.executionResultPath}\``);
    if (input.fallbackReason) lines.push(`- Fallback reason: ${input.fallbackReason}`);
    return lines;
  }
}
