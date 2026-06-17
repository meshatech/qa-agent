import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';

export interface AutoConfigBuildInput {
  previewUrl: string;
  prDiff: PrDiffContext;
  demand: DemandContext;
  projectPath: string;
  /** Explicit "owner/repo" override; otherwise resolved from env. */
  repo?: string;
  env?: NodeJS.ProcessEnv;
}

export interface AutoConfigBuildOutput {
  config: RunConfig;
  projectKey: { repo: string; branch: string };
  knowledgeFromMemory: boolean;
  knowledgeAnalyzed: boolean;
  warnings: string[];
}
