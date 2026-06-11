import { Logger } from '@nestjs/common';
import type { ToolResult } from '../../domain/schemas/tool-result.schema.js';
import type { ToolQueue } from '../../domain/schemas/tool-queue.schema.js';

export interface ToolExecutionRecord {
  step: number;
  tool: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  fallbackUsed?: boolean;
}

export interface ToolQueueExecutionReport {
  planId: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  fallbackSteps: number;
  records: ToolExecutionRecord[];
  summary: string;
  hasBlocks: boolean;
  hasBugs: boolean;
}

export class ToolQueueExecutionRecorderService {
  private readonly logger = new Logger(ToolQueueExecutionRecorderService.name);

  record(planId: string, queue: ToolQueue, results: ToolResult[]): ToolQueueExecutionReport {
    const records: ToolExecutionRecord[] = queue.taskQueue.map((item, index) => {
      const result = results[index];
      return {
        step: item.step,
        tool: item.tool,
        ok: result?.ok ?? false,
        durationMs: result?.durationMs ?? 0,
        errorCode: result?.error?.code,
        fallbackUsed: item.fallback !== undefined,
      };
    });

    const passedSteps = records.filter((r) => r.ok).length;
    const failedSteps = records.filter((r) => !r.ok).length;
    const fallbackSteps = records.filter((r) => r.fallbackUsed).length;

    const hasBlocks = failedSteps > 0;
    const hasBugs = records.some((r) => r.errorCode && r.errorCode !== 'OBSERVATION_FAILED');

    const summary = [
      `ToolQueue execution report for ${planId}`,
      `Total steps: ${records.length}`,
      `Passed: ${passedSteps}`,
      `Failed: ${failedSteps}`,
      `Fallbacks defined: ${fallbackSteps}`,
      `Status: ${hasBlocks ? 'BLOCKED' : 'OK'}`,
    ].join('\n');

    this.logger.debug(summary);

    return {
      planId,
      totalSteps: records.length,
      passedSteps,
      failedSteps,
      fallbackSteps,
      records,
      summary,
      hasBlocks,
      hasBugs,
    };
  }

  toMarkdown(report: ToolQueueExecutionReport): string {
    const lines: string[] = [
      '# ToolQueue Execution Report',
      '',
      `**Plan ID:** ${report.planId}`,
      `**Status:** ${report.hasBlocks ? 'BLOCKED' : 'OK'}`,
      '',
      '## Summary',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Steps | ${report.totalSteps} |`,
      `| Passed | ${report.passedSteps} |`,
      `| Failed | ${report.failedSteps} |`,
      `| Fallbacks | ${report.fallbackSteps} |`,
      '',
      '## Steps',
      '',
      `| Step | Tool | Result | Duration | Fallback | Error |`,
      `|------|------|--------|----------|----------|-------|`,
    ];

    for (const record of report.records) {
      const result = record.ok ? 'PASS' : 'FAIL';
      const fallback = record.fallbackUsed ? 'Yes' : 'No';
      const error = record.errorCode ?? '-';
      lines.push(`| ${record.step} | ${record.tool} | ${result} | ${record.durationMs}ms | ${fallback} | ${error} |`);
    }

    if (report.hasBugs) {
      lines.push('');
      lines.push('## Bugs');
      lines.push('');
      for (const record of report.records.filter((r) => r.errorCode)) {
        lines.push(`- **Step ${record.step}** (${record.tool}): ${record.errorCode}`);
      }
    }

    if (report.hasBlocks) {
      lines.push('');
      lines.push('## Blocks');
      lines.push('');
      lines.push('Execution blocked due to step failures.');
    }

    return lines.join('\n');
  }
}
