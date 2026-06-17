import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { LlmProviderPort } from '../ports/llm-provider.port.js';
import { SafeJsonParser } from '../../infra/llm/llm-output-normalizer.js';
import {
  PROJECT_ANALYSIS_SYSTEM_PROMPT,
  buildProjectAnalysisContext,
} from '../../infra/llm/project-analysis-skill.prompt.js';
import {
  ProjectKnowledgeSchema,
  type ProjectKnowledge,
  type ProjectKnowledgeConfidence,
} from '../../domain/schemas/project-knowledge.schema.js';
import type { ProjectAnalysisInputDto } from '../dto/project-analysis-input.dto.js';

/**
 * Analyzes a project from its source code (no browser probe) and returns ProjectKnowledge.
 * Robust by design: a missing/invalid LLM response yields a low-confidence "unknown" knowledge
 * rather than throwing, so the pipeline can still proceed.
 */
@Injectable()
export class ProjectAnalysisService {
  private readonly logger = new Logger(ProjectAnalysisService.name);

  constructor(
    @Inject('LlmProviderPort') private readonly llm: LlmProviderPort,
    @Inject(SafeJsonParser) private readonly jsonParser: SafeJsonParser,
  ) {}

  async analyze(input: ProjectAnalysisInputDto): Promise<ProjectKnowledge> {
    const analyzedAt = new Date().toISOString();
    const metadataBase = {
      repo: input.repo,
      branch: input.branch,
      analyzedAt,
      ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    };

    const codeSnapshot = await this.buildCodeSnapshot(input.projectPath, input.changedFiles);
    const context = buildProjectAnalysisContext({
      repo: input.repo,
      branch: input.branch,
      commitSha: input.commitSha,
      previewUrl: input.previewUrl,
      demand: input.demand,
      changedFiles: input.changedFiles,
      affectedRoutes: input.affectedRoutes,
      codeSnapshot,
    });

    let body: Record<string, unknown> = {};
    try {
      const result = await this.llm.complete({
        context,
        model: input.llmModel,
        systemPrompt: PROJECT_ANALYSIS_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 4096,
        phase: 'project-analysis',
      });
      const parsed = this.jsonParser.parse(result.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch (error) {
      this.logger.warn(`Project analysis LLM step failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const candidate = {
      ...body,
      metadata: { ...metadataBase, confidence: this.inferConfidence(body) },
    };

    const safe = ProjectKnowledgeSchema.safeParse(candidate);
    if (safe.success) return safe.data;

    this.logger.warn(`Project analysis output failed schema validation; falling back to minimal knowledge.`);
    return ProjectKnowledgeSchema.parse({
      metadata: { ...metadataBase, confidence: 'low' },
      auth: { kind: 'unknown' },
      notes: ['Project analysis produced no usable structured output; defaults applied.'],
    });
  }

  private inferConfidence(body: Record<string, unknown>): ProjectKnowledgeConfidence {
    const auth = body.auth as { kind?: string } | undefined;
    const modules = Array.isArray(body.allModules) ? body.allModules.length : 0;
    if (auth?.kind && auth.kind !== 'unknown' && modules >= 3) return 'high';
    if (modules >= 1 || (auth?.kind && auth.kind !== 'unknown')) return 'medium';
    return 'low';
  }

  private async buildCodeSnapshot(projectPath: string, changedFiles: string[]): Promise<string> {
    const parts: string[] = [];
    parts.push(`Project: ${basename(projectPath)}`);

    const readme =
      (await this.readSafe(join(projectPath, 'README.md'))) ??
      (await this.readSafe(join(projectPath, 'readme.md')));
    if (readme) parts.push('## README\n' + readme.slice(0, 1500));

    const pkg = await this.readSafe(join(projectPath, 'package.json'));
    if (pkg) {
      try {
        const json = JSON.parse(pkg) as { name?: string; dependencies?: Record<string, string> };
        const deps = Object.keys(json.dependencies ?? {}).slice(0, 16).join(', ');
        parts.push(`## package.json\n- name: ${json.name ?? 'unknown'}\n- deps: ${deps}`);
      } catch {
        /* ignore malformed package.json */
      }
    }

    const tree = await this.buildTree(projectPath);
    if (tree) parts.push('## Structure\n' + tree.slice(0, 1000));

    const samples = this.pickSamples(changedFiles, 8);
    for (const file of samples) {
      const content = await this.readSafe(join(projectPath, file));
      if (content) parts.push(`### ${file}\n${content.slice(0, 600)}`);
    }

    return parts.join('\n\n');
  }

  private pickSamples(files: string[], count: number): string[] {
    return files
      .filter((f) => /\.(ts|tsx|js|jsx|vue)$/.test(f))
      .filter((f) => /auth|login|sso|module|route|page|app/i.test(f))
      .slice(0, count);
  }

  private async buildTree(projectPath: string): Promise<string | null> {
    const { spawnSync } = await import('node:child_process');
    try {
      const result = spawnSync(
        'find',
        ['.', '-maxdepth', '3', '-type', 'd', '!', '-path', './node_modules/*', '!', '-path', './.git/*', '!', '-path', './dist/*'],
        { cwd: projectPath, encoding: 'utf8' },
      );
      if (result.error || result.status !== 0) return null;
      return result.stdout.split('\n').sort().join('\n');
    } catch {
      return null;
    }
  }

  private async readSafe(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }
}
