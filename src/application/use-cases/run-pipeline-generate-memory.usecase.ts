import { Inject, Injectable } from '@nestjs/common';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineGenerateMemoryRunResult } from '../dto/pipeline-generate-memory-result.dto.js';
import { DiffMemoryExtractorService } from '../services/diff-memory-extractor.service.js';

const MEMORY_FILE = 'memory.md';
const AGENT_QA_DIR = '.agent-qa';

@Injectable()
export class RunPipelineGenerateMemoryUseCase {
  constructor(
    @Inject(DiffMemoryExtractorService) private readonly extractor: DiffMemoryExtractorService,
  ) {}

  async execute(
    projectPath: string,
    options?: { changedFiles?: string[]; outputDir?: string },
  ): Promise<PipelineGenerateMemoryRunResult> {
    const outputDir = resolve(options?.outputDir ?? join(projectPath, AGENT_QA_DIR));
    await mkdir(outputDir, { recursive: true });

    // Strategy: if user provided changedFiles, use those; otherwise scan ENTIRE project
    let changedFiles = options?.changedFiles;
    if (!changedFiles) {
      changedFiles = await this.listAllSourceFiles(projectPath);
    }

    const chunks = await this.extractor.extract({ projectPath, changedFiles });

    const markdown = this.renderMemoryMarkdown(chunks);

    const memoryPath = resolve(join(outputDir, MEMORY_FILE));
    await writeFile(memoryPath, markdown, 'utf8');

    return {
      memoryPath,
      chunksGenerated: chunks.length,
      routeChunks: chunks.filter((c) => c.type === 'route').length,
      componentChunks: chunks.filter((c) => c.type === 'component').length,
      locatorChunks: chunks.filter((c) => c.type === 'semantic_locator').length,
      projectChunk: chunks.some((c) => c.type === 'project'),
    };
  }

  private async detectChangedFiles(projectPath: string): Promise<string[]> {
    const { execSync } = await import('node:child_process');
    try {
      const output = execSync('git diff --name-only HEAD~1', { cwd: projectPath, encoding: 'utf8' });
      return output.split('\n').filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private async listAllSourceFiles(projectPath: string): Promise<string[]> {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, extname } = await import('node:path');
    const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue']);
    const results: string[] = [];

    const walk = (dir: string, prefix = '') => {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const s = statSync(full);
        if (s.isDirectory()) {
          walk(full, rel);
        } else if (sourceExts.has(extname(entry))) {
          results.push(rel);
        }
      }
    };

    walk(projectPath);
    return results;
  }

  private renderMemoryMarkdown(chunks: import('../services/diff-memory-extractor.service.js').DiffMemoryChunk[]): string {
    const lines = ['# Memória do Projeto\n'];

    for (const chunk of chunks) {
      lines.push(`## ${chunk.title}\n`);
      lines.push(`<!-- type: ${chunk.type} | id: ${chunk.id} -->\n`);
      lines.push(chunk.content);
      lines.push('\n');
    }

    return lines.join('\n');
  }
}
