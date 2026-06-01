import { Injectable } from '@nestjs/common';
import type { LearningCandidate } from '../../domain/schemas/learning-candidate.schema.js';

const TYPE_MAP: Record<string, string> = {
  semantic_locator: 'semantic_locator',
  route_mapping: 'route',
  component_behavior: 'known_issue',
  recovery_pattern: 'runtime_learning',
  gap: 'known_issue',
};

function escapeMarkdown(text: string): string {
  return text.replace(/([\\\-[[\]()>])/g, '\\$1');
}

@Injectable()
export class MemoryChunkRenderer {
  render(candidate: LearningCandidate): string | null {
    const chunkType = TYPE_MAP[candidate.type];
    if (!chunkType) return null;

    const id = candidate.id.replace(/[^a-zA-Z0-9_-]/g, '-').toUpperCase();

    const lines: string[] = [];
    lines.push(`## ${escapeMarkdown(candidate.description)}`);
    lines.push('');
    lines.push(`<!-- type: ${chunkType} | id: ${id} -->`);
    lines.push(`- **Description**: ${escapeMarkdown(candidate.description)}`);
    lines.push(`- **Content**: ${escapeMarkdown(candidate.content)}`);
    lines.push(`- **Source**: ${escapeMarkdown(candidate.source)}`);
    lines.push(`- **Confidence**: ${candidate.confidence}`);
    if (candidate.risk) lines.push(`- **Risk**: ${escapeMarkdown(candidate.risk)}`);
    lines.push(`- **Generated**: ${candidate.generatedAt}`);
    lines.push('');

    return lines.join('\n');
  }

  renderAll(candidates: LearningCandidate[]): { chunks: string[]; warnings: string[] } {
    const chunks: string[] = [];
    const warnings: string[] = [];

    for (const candidate of candidates) {
      const chunk = this.render(candidate);
      if (chunk) {
        chunks.push(chunk);
      } else {
        warnings.push(`Could not convert candidate ${candidate.id} to memory chunk: unknown type ${candidate.type}`);
      }
    }

    return { chunks, warnings };
  }
}
