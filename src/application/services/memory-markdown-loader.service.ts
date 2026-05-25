import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

export interface LoadedMemoryMarkdown {
  text: string;
  sourceFile: string;
}

@Injectable()
export class MemoryMarkdownLoader {
  resolveMemoryPath(projectPath: string): string {
    return join(projectPath, '.agent-qa', 'memory.md');
  }

  async load(memoryPath: string): Promise<LoadedMemoryMarkdown> {
    const text = await readFile(memoryPath, 'utf8').catch(() => '');
    return { text, sourceFile: memoryPath };
  }

  async loadProject(projectPath = '.'): Promise<LoadedMemoryMarkdown> {
    return this.load(this.resolveMemoryPath(projectPath));
  }
}
