import type { RunConfig } from '../../domain/schemas/config.schema.js';

export interface AutoConfigRunResult {
  /** Path where the generated agent-qa.config.json was written. */
  configPath: string;
  /** The validated generated config. */
  config: RunConfig;
  /** Resolved repo+branch key used for project memory. */
  projectKey: { repo: string; branch: string };
  /** Whether project knowledge came from memory (true) or was freshly analyzed (false). */
  knowledgeFromMemory: boolean;
  /** Whether a fresh project analysis ran this invocation. */
  knowledgeAnalyzed: boolean;
  warnings: string[];
}
