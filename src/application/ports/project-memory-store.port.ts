import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';

/** Identifies a project knowledge entry. Keyed by repo + base branch (doc section 9 #2). */
export interface ProjectMemoryKey {
  repo: string;
  branch: string;
}

/** Long-term, per-project knowledge store (Postgres in CI, file fallback locally). */
export interface ProjectMemoryStorePort {
  load(key: ProjectMemoryKey): Promise<ProjectKnowledge | null>;
  save(knowledge: ProjectKnowledge): Promise<void>;
}
