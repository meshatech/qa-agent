import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmProviderPort } from '../ports/llm-provider.port.js';

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'diff-memory-extractor.prompt.md');

export interface DiffMemoryChunk {
  id: string;
  type: 'route' | 'component' | 'semantic_locator' | 'flow' | 'project' | 'known_issue';
  title: string;
  content: string;
}

export interface ExtractMemoryFromDiffInput {
  projectPath: string;
  changedFiles: string[];
  llmApiKey?: string;
  llmModel?: string; // e.g. 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'
}

@Injectable()
export class DiffMemoryExtractorService {
  private systemPrompt: string | null = null;

  constructor(
    @Inject('LlmProviderPort') private readonly llm: LlmProviderPort,
  ) {}

  private async loadSystemPrompt(): Promise<string> {
    if (this.systemPrompt) return this.systemPrompt;
    this.systemPrompt = await readFile(PROMPT_PATH, 'utf8');
    return this.systemPrompt;
  }

  async extract(input: ExtractMemoryFromDiffInput): Promise<DiffMemoryChunk[]> {
    const { projectPath, changedFiles, llmModel = 'llama-3.3-70b-versatile' } = input;
    const systemPrompt = await this.loadSystemPrompt();

    // Phase 1: Build lightweight base context (README, package.json, tree, git history)
    const baseContext = await this.buildBaseContext(projectPath, changedFiles);

    // Phase 2: Group source files by logical category
    const groups = this.groupFilesByCategory(changedFiles);

    // Phase 3: Process each group with LLM, accumulating chunks
    const allChunks: DiffMemoryChunk[] = [];
    const delayMs = Number(process.env.GROQ_DELAY_MS ?? 25000);

    for (const [category, files] of groups) {
      const groupContext = await this.buildGroupContext(projectPath, category, files, baseContext);
      const result = await this.llm.complete({
        context: groupContext,
        model: llmModel,
        systemPrompt,
        temperature: 0.2,
        maxTokens: 4096,
        phase: category,
      });
      const chunks = this.parseMarkdownChunks(result.content);
      allChunks.push(...chunks);
      // Respect rate limits configured via env
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Phase 4: Consolidation pass
    const consolidationContext = this.buildConsolidationContext(projectPath, baseContext, allChunks);
    const finalResult = await this.llm.complete({
      context: consolidationContext,
      model: llmModel,
      systemPrompt,
      temperature: 0.2,
      maxTokens: 4096,
      phase: 'consolidate',
    });
    const finalChunks = this.parseMarkdownChunks(finalResult.content);

    return finalChunks.length > 0 ? finalChunks : allChunks;
  }

  private async buildBaseContext(projectPath: string, changedFiles: string[]): Promise<string> {
    const parts: string[] = [];
    parts.push(`# Project: ${basename(projectPath)}`);
    parts.push(`Path: ${projectPath}\n`);

    const readme = await this.readFileSafe(join(projectPath, 'README.md'))
      ?? await this.readFileSafe(join(projectPath, 'readme.md'));
    if (readme) parts.push('## README\n```markdown\n' + readme.slice(0, 1500) + '\n```\n');

    const pkg = await this.readFileSafe(join(projectPath, 'package.json'));
    if (pkg) {
      try {
        const json = JSON.parse(pkg);
        parts.push('## Tech Stack\n');
        parts.push(`- Name: ${json.name ?? 'unknown'}`);
        parts.push(`- Framework: ${json.dependencies?.next ? 'Next.js' : json.dependencies?.react ? 'React' : 'unknown'}`);
        parts.push(`- Deps: ${Object.keys(json.dependencies ?? {}).slice(0, 12).join(', ')}\n`);
      } catch { /* ignore */ }
    }

    const tree = await this.buildDirectoryTree(projectPath);
    parts.push('## Structure\n```\n' + tree.slice(0, 800) + '\n```\n');

    const sourceCount = changedFiles.filter((f) => /\.(ts|tsx|js|jsx|vue)$/.test(f)).length;
    parts.push(`## Source Files: ${sourceCount}\n`);

    const gitHistory = await this.getGitHistory(projectPath);
    if (gitHistory) parts.push('## Commits\n```\n' + gitHistory.slice(0, 500) + '\n```\n');

    return parts.join('\n');
  }

  private groupFilesByCategory(files: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    groups.set('routes', []);
    groups.set('components', []);
    groups.set('tests', []);
    groups.set('api_services', []);
    groups.set('hooks_utils', []);
    groups.set('other', []);

    for (const file of files) {
      if (/\.(test|spec)\./.test(file) || file.includes('__tests__')) {
        groups.get('tests')!.push(file);
      } else if (file.includes('/api/') || file.includes('/services/') || file.includes('/infra/')) {
        groups.get('api_services')!.push(file);
      } else if (/page\.(tsx|jsx|vue)$/.test(file) || (file.includes('/app/') && /\.(tsx|jsx)$/.test(file) && !file.includes('/components/'))) {
        groups.get('routes')!.push(file);
      } else if (file.includes('/components/') || file.includes('/ui/') || file.includes('/features/')) {
        groups.get('components')!.push(file);
      } else if (file.includes('/hooks/') || file.includes('/utils/') || file.includes('/lib/')) {
        groups.get('hooks_utils')!.push(file);
      } else if (/\.(ts|tsx|js|jsx|vue)$/.test(file)) {
        groups.get('other')!.push(file);
      }
    }

    for (const [key, val] of Array.from(groups.entries())) {
      if (val.length === 0) groups.delete(key);
    }
    return groups;
  }

  private async buildGroupContext(projectPath: string, category: string, files: string[], baseContext: string): Promise<string> {
    const parts: string[] = [baseContext];
    parts.push(`## CATEGORY: ${category.toUpperCase()} (${files.length} files)\n`);

    const sample = this.pickRepresentativeFiles(files, 6);
    for (const file of sample) {
      const content = await this.readFileSafe(join(projectPath, file));
      if (content) {
        parts.push(`### ${file}\n\`\`\`typescript\n${content.slice(0, 500)}\n\`\`\`\n`);
      }
    }
    return parts.join('\n');
  }

  private buildConsolidationContext(projectPath: string, baseContext: string, chunks: DiffMemoryChunk[]): string {
    const parts: string[] = [baseContext];
    parts.push(`## Discovered Chunks (${chunks.length})\n`);
    for (const chunk of chunks) {
      parts.push(`- [${chunk.type}] ${chunk.id}: ${chunk.title}`);
    }
    parts.push('\n## Instructions\nConsolidate ALL chunks into a single coherent memory.md. Merge duplicates, ensure every route/component/locator is included. Use standard chunk format with <!-- type: ... | id: ... --> metadata.\n');
    return parts.join('\n');
  }

  private async buildDirectoryTree(projectPath: string): Promise<string> {
    const { execSync } = await import('node:child_process');
    try {
      const output = execSync(
        `find . -maxdepth 3 -type d ! -path './node_modules/*' ! -path './.git/*' ! -path './.next/*' ! -path './dist/*' | sort`,
        { cwd: projectPath, encoding: 'utf8' },
      );
      return output;
    } catch {
      return 'Directory tree not available';
    }
  }

  private pickRepresentativeFiles(files: string[], count: number): string[] {
    const byDir = new Map<string, string[]>();
    for (const file of files) {
      const dir = file.split('/').slice(0, 3).join('/');
      const existing = byDir.get(dir) ?? [];
      existing.push(file);
      byDir.set(dir, existing);
    }

    const picked: string[] = [];
    const dirs = Array.from(byDir.keys()).sort();
    let round = 0;
    while (picked.length < count && round < 10) {
      for (const dir of dirs) {
        const dirFiles = byDir.get(dir)!;
        if (dirFiles[round] && picked.length < count) {
          picked.push(dirFiles[round]);
        }
      }
      round++;
    }
    return picked;
  }

  private async getGitHistory(projectPath: string): Promise<string | null> {
    const { execSync } = await import('node:child_process');
    try {
      return execSync('git log --oneline -20', { cwd: projectPath, encoding: 'utf8' });
    } catch {
      return null;
    }
  }


  private parseMarkdownChunks(markdown: string): DiffMemoryChunk[] {
    const chunks: DiffMemoryChunk[] = [];
    const sections = markdown.split(/^## /m).slice(1);

    for (const section of sections) {
      const lines = section.split('\n');
      const title = (lines.shift() ?? '').trim();
      if (!title) continue;

      const body = lines.join('\n').trim();
      const metadataMatch = body.match(/<!--\s*type:\s*(\w+)\s*\|\s*id:\s*([A-Z0-9-]+)\s*-->/i);
      if (!metadataMatch) continue;

      const type = metadataMatch[1].toLowerCase() as DiffMemoryChunk['type'];
      const id = metadataMatch[2].toUpperCase();
      const content = body.replace(/<!--[^>]+-->/, '').trim();

      chunks.push({ id, type, title, content });
    }

    return chunks;
  }

  private async readFileSafe(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }
}
