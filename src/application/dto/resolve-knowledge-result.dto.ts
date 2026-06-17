import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';

export interface ResolveKnowledgeResultDto {
  knowledge: ProjectKnowledge;
  fromMemory: boolean;
  analyzed: boolean;
}
