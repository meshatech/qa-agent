import { Injectable } from '@nestjs/common';
import type { LearningCandidate } from '../../domain/schemas/learning-candidate.schema.js';
import type { MemoryChunkType } from '../../domain/schemas/memory.schema.js';

export const LEARNING_TYPE_TO_MEMORY_TYPE: Record<LearningCandidate['type'], MemoryChunkType> = {
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
  chunkType(candidate: LearningCandidate): MemoryChunkType | null {
    return LEARNING_TYPE_TO_MEMORY_TYPE[candidate.type] ?? null;
  }

  chunkId(candidate: LearningCandidate): string {
    return candidate.id.replace(/[^a-zA-Z0-9_-]/g, '-').toUpperCase();
  }

  renderBody(candidate: LearningCandidate): string | null {
    if (!this.chunkType(candidate)) return null;

    const lines: string[] = [];
    lines.push(`- **Description**: ${escapeMarkdown(candidate.description)}`);
    lines.push(`- **Content**: ${escapeMarkdown(candidate.content)}`);
    lines.push(`- **Source**: ${escapeMarkdown(candidate.source)}`);
    lines.push(`- **Confidence**: ${candidate.confidence}`);
    if (candidate.risk) lines.push(`- **Risk**: ${escapeMarkdown(candidate.risk)}`);
    lines.push(`- **Generated**: ${candidate.generatedAt}`);

    return lines.join('\n');
  }

  render(candidate: LearningCandidate): string | null {
    const chunkType = this.chunkType(candidate);
    const body = this.renderBody(candidate);
    if (!chunkType || !body) return null;

    const id = this.chunkId(candidate);

    const lines: string[] = [];
    lines.push(`## ${escapeMarkdown(candidate.description)}`);
    lines.push('');
    lines.push(`<!-- type: ${chunkType} | id: ${id} -->`);
    lines.push(body);
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
