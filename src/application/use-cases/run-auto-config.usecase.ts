import { Inject, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { AutoConfigRunResult } from '../dto/auto-config-result.dto.js';
import { AutoConfigBuilderService } from '../services/auto-config-builder.service.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import { ConfigError } from '../../domain/errors.js';
import { PrDiffContextSchema } from '../../domain/schemas/pr-diff-context.schema.js';
import { DemandContextSchema } from '../../domain/schemas/demand-context.schema.js';

export const GENERATED_CONFIG_FILE = 'agent-qa.config.json';

@Injectable()
export class RunAutoConfigUseCase {
  constructor(
    @Inject(AutoConfigBuilderService) private readonly builder: AutoConfigBuilderService,
  ) {}

  async execute(
    outputDir: string,
    options?: { previewUrl?: string; projectPath?: string; env?: NodeJS.ProcessEnv },
  ): Promise<AutoConfigRunResult> {
    const env = options?.env ?? process.env;
    const previewUrl = options?.previewUrl?.trim() || env.QA_AGENT_BASE_URL?.trim();
    if (!previewUrl) {
      throw new ConfigError('Preview URL is required for auto-config: pass --preview-url or set QA_AGENT_BASE_URL.');
    }

    const prDiff = await readPipelineArtifact(outputDir, 'pr-diff-context.json', PrDiffContextSchema);
    const demand = await readPipelineArtifact(outputDir, 'demand-context.json', DemandContextSchema);
    const projectPath = options?.projectPath ?? process.cwd();

    const built = await this.builder.build({ previewUrl, prDiff, demand, projectPath, env });

    const configPath = resolve(join(outputDir, GENERATED_CONFIG_FILE));
    await mkdir(resolve(outputDir), { recursive: true });
    await writeFile(configPath, JSON.stringify(built.config, null, 2), 'utf8');

    return {
      configPath,
      config: built.config,
      projectKey: built.projectKey,
      knowledgeFromMemory: built.knowledgeFromMemory,
      knowledgeAnalyzed: built.knowledgeAnalyzed,
      warnings: built.warnings,
    };
  }
}
