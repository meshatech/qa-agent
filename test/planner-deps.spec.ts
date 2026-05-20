import { describe, expect, it } from 'vitest';
import { ScenarioPlannerService } from '../src/application/services/scenario-planner.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({
  baseUrl: 'http://127.0.0.1',
  appDomains: ['127.0.0.1'],
  demand: { id: 'D', title: 'Demand', description: 'fallback' },
});

const provider: DecisionProviderPort = {
  async plan() {
    return [{
      id: 's1',
      title: 'S1',
      status: 'PLANNED',
      tasks: [
        { id: 'T003', title: 'last', expected: 'ok', status: 'PENDING', dependsOn: ['T002'] },
        { id: 'T001', title: 'first', expected: 'ok', status: 'PENDING' },
        { id: 'T002', title: 'middle', expected: 'ok', status: 'PENDING', dependsOn: ['T001'] },
        { id: 'T999', title: 'orphan', expected: 'ok', status: 'PENDING', dependsOn: ['NON_EXISTENT'] },
      ],
    }];
  },
  async decide() {
    throw new Error('unused');
  },
};

describe('ScenarioPlanner topological sort with deps', () => {
  it('orders tasks respecting dependsOn and removes invalid deps', async () => {
    const scenarios = await new ScenarioPlannerService(provider).plan(config);
    const ids = scenarios[0]!.tasks.map((t) => t.id);
    expect(ids.indexOf('T001')).toBeLessThan(ids.indexOf('T002'));
    expect(ids.indexOf('T002')).toBeLessThan(ids.indexOf('T003'));
    const orphan = scenarios[0]!.tasks.find((t) => t.id === 'T999');
    expect(orphan?.dependsOn).toEqual([]);
  });

  it('fallback respects acceptanceCriteria and infers intent', async () => {
    const fallbackProvider: DecisionProviderPort = {
      async plan() {
        throw new Error('no plan');
      },
      async decide() {
        throw new Error('unused');
      },
    };
    const cfg = RunConfigSchema.parse({
      baseUrl: 'http://127.0.0.1',
      appDomains: ['127.0.0.1'],
      demand: { id: 'D', title: 'X', description: 'Y', acceptanceCriteria: ['caso positivo', 'caso inválido', 'caso de borda'] },
    });
    const scenarios = await new ScenarioPlannerService(fallbackProvider).plan(cfg);
    const tasks = scenarios[0]!.tasks;
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.intent).toBe('POSITIVE');
    expect(tasks[1]!.intent).toBe('NEGATIVE');
    expect(tasks[2]!.intent).toBe('EDGE');
    expect(tasks[1]!.dependsOn).toEqual(['T001']);
  });
});
