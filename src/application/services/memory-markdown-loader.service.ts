import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

export const MEMORY_HEADER_V1 = '<!-- agent-qa-memory v1 -->';

export type MemorySchemaVersion = 'v1' | 'legacy';

export interface LoadedMemoryMarkdown {
  text: string;
  sourceFile: string;
  schemaVersion: MemorySchemaVersion;
  warnings: string[];
}

@Injectable()
export class MemoryMarkdownLoader {
  resolveMemoryPath(projectPath: string): string {
    return join(projectPath, '.agent-qa', 'memory.md');
  }

  async load(memoryPath: string): Promise<LoadedMemoryMarkdown> {
    const text = await readFile(memoryPath, 'utf8').catch(() => '');
    return { text, sourceFile: memoryPath, ...this.detectSchemaVersion(text, memoryPath) };
  }

  async loadProject(projectPath = '.'): Promise<LoadedMemoryMarkdown> {
    return this.load(this.resolveMemoryPath(projectPath));
  }

  private detectSchemaVersion(text: string, sourceFile: string): { schemaVersion: MemorySchemaVersion; warnings: string[] } {
    if (!text.trim()) {
      return { schemaVersion: 'v1', warnings: [] };
    }

    const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    if (firstLine.trim() === MEMORY_HEADER_V1) {
      return { schemaVersion: 'v1', warnings: [] };
    }

    return {
      schemaVersion: 'legacy',
      warnings: [`Memory file ${sourceFile} is missing the "${MEMORY_HEADER_V1}" header (legacy format).`],
    };
  }
}
