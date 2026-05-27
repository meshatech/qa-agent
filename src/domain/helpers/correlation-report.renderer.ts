import type { CorrelationResult } from '../schemas/correlation.schema.js';
import { truncate } from './correlation-lexical.js';

export interface CorrelationReportContext {
  demandTitle?: string;
  prNumber?: number;
}

export function renderCorrelationReport(
  result: CorrelationResult,
  context?: CorrelationReportContext,
): string {
  const lines: string[] = ['# Correlation Report', '', `Status: **${result.status}**`];

  if (context?.demandTitle) {
    lines.push(`Demand: ${context.demandTitle}`);
  }
  if (context?.prNumber !== undefined) {
    lines.push(`PR: #${context.prNumber}`);
  }

  lines.push('', '## Required Scenarios', '');
  if (!result.scenarios.length) {
    lines.push('_No scenarios generated._');
  } else {
    for (const scenario of result.scenarios) {
      lines.push(`### ${scenario.id} — ${scenario.title}`);
      lines.push(`- Intent: ${scenario.intent}`);
      lines.push(`- Risk score: ${scenario.riskScore.toFixed(2)}`);
      lines.push(`- Related files: ${scenario.relatedFiles.length ? scenario.relatedFiles.join(', ') : '—'}`);
      lines.push(`- Rationale: ${scenario.rationale}`);
      lines.push('');
    }
  }

  lines.push('## Correlations', '');
  if (!result.correlations.length) {
    lines.push('_No correlations._');
  } else {
    for (const item of result.correlations) {
      lines.push(
        `- **${truncate(item.criterion, 80)}** → ${item.file ?? 'no file'} (score ${item.score.toFixed(2)})`,
      );
      lines.push(`  - ${item.rationale}`);
      if (item.memoryChunk) {
        lines.push(`  - Memory: ${item.memoryChunk}`);
      }
    }
  }

  lines.push('', '## Risks', '');
  if (!result.risks.length) {
    lines.push('_No risks identified._');
  } else {
    for (const risk of result.risks) {
      lines.push(`- [${risk.severity}] ${risk.type}: ${risk.description}`);
    }
  }

  if (result.warnings.length) {
    lines.push('', '## Warnings', '');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (result.status === 'BLOCKED' && result.blockReason) {
    lines.push('', '## Block Reason', '', result.blockReason);
  }

  return `${lines.join('\n')}\n`;
}
