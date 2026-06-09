import type { ProjectGraph, ProjectGraphExperience } from '../../domain/schemas/project-graph.schema.js';

export interface ProjectGraphPort {
  load(projectPath: string): Promise<ProjectGraph>;
  save(projectPath: string, graph: ProjectGraph): Promise<void>;
  query(projectPath: string, kind: string): Promise<ProjectGraph['nodes']>;
  recordExperience(projectPath: string, exp: ProjectGraphExperience): Promise<void>;
}
