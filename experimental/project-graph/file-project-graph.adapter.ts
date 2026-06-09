import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProjectGraphPort } from '../../application/ports/project-graph.port.js';
import { ProjectGraphSchema, ProjectGraphExperienceSchema, type ProjectGraph, type ProjectGraphExperience } from '../../domain/schemas/project-graph.schema.js';

const GRAPH_FILENAME = '.agent-qa/project-graph.json';

function emptyGraph(): ProjectGraph {
  return { version: 'graph.v1', updatedAt: new Date().toISOString(), nodes: [], edges: [] };
}

export class JsonFileProjectGraphAdapter implements ProjectGraphPort {
  async load(projectPath: string): Promise<ProjectGraph> {
    const path = join(projectPath, GRAPH_FILENAME);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      return ProjectGraphSchema.parse(parsed);
    } catch {
      return emptyGraph();
    }
  }

  async save(projectPath: string, graph: ProjectGraph): Promise<void> {
    const path = join(projectPath, GRAPH_FILENAME);
    await mkdir(dirname(path), { recursive: true });
    const updated: ProjectGraph = { ...graph, updatedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(updated, null, 2), 'utf-8');
  }

  async query(projectPath: string, kind: string): Promise<ProjectGraph['nodes']> {
    const graph = await this.load(projectPath);
    return graph.nodes.filter((n) => n.kind === kind);
  }

  async recordExperience(projectPath: string, exp: ProjectGraphExperience): Promise<void> {
    const validated = ProjectGraphExperienceSchema.parse(exp);
    const graph = await this.load(projectPath);

    const nodeId = `outcome:${validated.outcomeKind}`;
    const existing = graph.nodes.find((n) => n.id === nodeId);
    if (existing) {
      existing.hits += validated.successCount;
      existing.misses += validated.failureCount;
      existing.lastUsed = new Date().toISOString();
      Object.assign(existing.data, {
        validatedLocators: validated.validatedLocators,
        expectedStates: validated.expectedStates,
        appUrlPattern: validated.appUrlPattern,
      });
    } else {
      graph.nodes.push({
        id: nodeId,
        kind: 'outcome',
        data: {
          validatedLocators: validated.validatedLocators,
          expectedStates: validated.expectedStates,
          appUrlPattern: validated.appUrlPattern,
        },
        appUrlPattern: validated.appUrlPattern,
        hits: validated.successCount,
        misses: validated.failureCount,
        lastUsed: new Date().toISOString(),
      });
    }

    await this.save(projectPath, graph);
  }
}
