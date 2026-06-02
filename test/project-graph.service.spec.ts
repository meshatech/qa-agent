import { describe, expect, it } from 'vitest';
import { ProjectGraphService } from '../src/application/services/project-graph.service.js';
import type { ProjectGraphPort } from '../src/application/ports/project-graph.port.js';
import type { ExecutionPlan } from '../src/domain/schemas/execution-plan.schema.js';
import type { PlanExecutionResult } from '../src/application/services/plan-executor.service.js';

function makeFakePort(): ProjectGraphPort {
  const graphs = new Map<string, import('../src/domain/schemas/project-graph.schema.js').ProjectGraph>();
  return {
    async load(projectPath) {
      return graphs.get(projectPath) ?? { version: 'graph.v1', updatedAt: new Date().toISOString(), nodes: [], edges: [] };
    },
    async save(projectPath, graph) {
      graphs.set(projectPath, graph);
    },
    async query(projectPath, kind) {
      const graph = await this.load(projectPath);
      return graph.nodes.filter((n) => n.kind === kind);
    },
    async recordExperience(projectPath, exp) {
      const graph = await this.load(projectPath);
      const nodeId = `outcome:${exp.outcomeKind}`;
      const existing = graph.nodes.find((n) => n.id === nodeId);
      if (existing) {
        existing.hits += exp.successCount;
        existing.misses += exp.failureCount;
      } else {
        graph.nodes.push({ id: nodeId, kind: 'outcome', data: { validatedLocators: exp.validatedLocators, expectedStates: exp.expectedStates }, hits: exp.successCount, misses: exp.failureCount });
      }
      await this.save(projectPath, graph);
    },
  };
}

describe('ProjectGraphService', () => {
  it('enrichPlan returns plan unchanged when no matching nodes', async () => {
    const service = new ProjectGraphService(makeFakePort());
    const plan: ExecutionPlan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'p1',
      version: 1,
      goal: 'Test',
      mode: 'PLAN_AND_EXECUTE',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
      assertions: [],
      steps: [{ id: 'S1', description: 'Click login', preconditions: [], action: { type: 'click', target: { strategy: 'text', text: 'Login' }, reason: 'test' }, postconditions: [{ type: 'no_console_errors' }], assertions: [], onFailure: 'RECOVER' }],
    };
    const enriched = await service.enrichPlan(plan, '/tmp/project');
    expect(enriched.steps[0].preconditions.length).toBe(0);
  });

  it('recordRunResult records locators from telemetry', async () => {
    const port = makeFakePort();
    const service = new ProjectGraphService(port);
    const result: PlanExecutionResult = {
      ok: true,
      steps: [],
      attempts: [],
      warnings: [],
      finalPlan: { schemaVersion: 'execution-plan.v1', planId: 'p1', version: 1, goal: 'Test', mode: 'PLAN_AND_EXECUTE', runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' }, assertions: [], steps: [] },
      patchHistory: [],
      evaluations: [],
      locatorTelemetry: [{ stepId: 'S1', type: 'deterministic_resolution', locatorStrategy: 'text', elementId: 'el_1', timestamp: '2026-01-01T00:00:00Z' }],
    };
    await service.recordRunResult(result, '/tmp/project');
    const nodes = await port.query('/tmp/project', 'outcome');
    expect(nodes.length).toBe(1);
    expect(nodes[0].hits).toBe(1);
  });

  it('getHintsForOutcome returns data when node exists', async () => {
    const port = makeFakePort();
    const service = new ProjectGraphService(port);
    await port.recordExperience('/tmp/project', { outcomeKind: 'LOGIN', validatedLocators: [{ strategy: 'text', text: 'Entrar' }], expectedStates: [], successCount: 5, failureCount: 0 });
    const hints = await service.getHintsForOutcome('LOGIN', '/tmp/project');
    expect(hints.length).toBe(1);
    expect(hints[0].confidence).toBe(1);
  });

  it('getHintsForOutcome returns empty array when node missing', async () => {
    const service = new ProjectGraphService(makeFakePort());
    const hints = await service.getHintsForOutcome('MISSING', '/tmp/project');
    expect(hints).toEqual([]);
  });
});
