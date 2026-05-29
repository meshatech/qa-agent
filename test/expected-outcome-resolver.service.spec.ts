import { describe, expect, it } from 'vitest';
import { ExpectedOutcomeResolverService } from '../src/application/services/expected-outcome-resolver.service.js';
import type { DecisionProviderPort } from '../src/application/ports/decision-provider.port.js';
import type { QaTask } from '../src/domain/models/run.model.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

function makeTask(partial: Partial<QaTask> & { title: string }): QaTask {
  return { id: 'T1', expected: '', status: 'PENDING', ...partial };
}

function makeConfig() {
  return RunConfigSchema.parse({
    baseUrl: 'http://localhost',
    appDomains: ['localhost'],
    demand: { id: 'D1', title: 'Test', description: 'test' },
    auth: { kind: 'none' },
    llm: { provider: 'groq', model: 'm', apiKeyEnv: 'K' },
  });
}

describe('ExpectedOutcomeResolverService', () => {
  it('returns existing expectedOutcome when present', async () => {
    const provider: DecisionProviderPort = { async decide() { throw new Error('unused'); } };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const task = makeTask({ title: 'any', expectedOutcome: { kind: 'NAVIGATION', description: 'nav' } });
    const result = await resolver.resolve(makeConfig(), task);
    expect(result).toEqual({ kind: 'NAVIGATION', description: 'nav' });
  });

  it('calls LLM classifyOutcome when no contract is present', async () => {
    const provider: DecisionProviderPort = {
      async classifyOutcome(_cfg, task) {
        return { kind: 'DEAUTHENTICATION', description: task.title };
      },
      async decide() { throw new Error('unused'); },
    };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const task = makeTask({ title: 'cerrar sesión' });
    const result = await resolver.resolve(makeConfig(), task);
    expect(result.kind).toBe('DEAUTHENTICATION');
    expect(result.description).toBe('cerrar sesión');
  });

  it('returns CLASSIFICATION_FAILED when classifyOutcome throws', async () => {
    const provider: DecisionProviderPort = {
      async classifyOutcome() { throw new Error('unavailable'); },
      async decide() { throw new Error('unused'); },
    };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const task = makeTask({ title: '任意のタスク' });
    const result = await resolver.resolve(makeConfig(), task);
    expect(result.kind).toBe('CLASSIFICATION_FAILED');
    expect(result.description).toBe('任意のタスク');
  });

  it('falls back to NO_REGRESSION when classifyOutcome is not implemented', async () => {
    const provider: DecisionProviderPort = { async decide() { throw new Error('unused'); } };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const task = makeTask({ title: 'une tâche quelconque' });
    const result = await resolver.resolve(makeConfig(), task);
    expect(result.kind).toBe('NO_REGRESSION');
    expect(result.description).toBe('une tâche quelconque');
  });

  it('resolveMany preserves existing contracts and batch-classifies only unresolved tasks', async () => {
    const classifiedTitles: string[] = [];
    const provider: DecisionProviderPort = {
      async classifyOutcomes(_cfg, tasks) {
        classifiedTitles.push(...tasks.map((task) => task.title));
        return tasks.map((task) => ({ kind: 'CONTENT_PRESENCE' as const, description: task.title }));
      },
      async decide() { throw new Error('unused'); },
    };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const tasks = [
      makeTask({ id: 'T1', title: 'already', expectedOutcome: { kind: 'NAVIGATION', description: 'existing' } }),
      makeTask({ id: 'T2', title: 'classify me' }),
    ];

    const result = await resolver.resolveMany(makeConfig(), tasks);

    expect(classifiedTitles).toEqual(['classify me']);
    expect(result).toEqual([
      { kind: 'NAVIGATION', description: 'existing' },
      { kind: 'CONTENT_PRESENCE', description: 'classify me' },
    ]);
  });

  it('resolveMany falls back per task when batch classification fails', async () => {
    const provider: DecisionProviderPort = {
      async classifyOutcomes() {
        throw new Error('batch unavailable');
      },
      async classifyOutcome(_cfg, task) {
        if (task.title === 'bad') throw new Error('single unavailable');
        return { kind: 'DISCLOSURE', description: task.title };
      },
      async decide() { throw new Error('unused'); },
    };
    const resolver = new ExpectedOutcomeResolverService(provider);
    const tasks = [
      makeTask({ id: 'T1', title: 'good' }),
      makeTask({ id: 'T2', title: 'bad' }),
      makeTask({ id: 'T3', title: 'already', expectedOutcome: { kind: 'AUTHENTICATION', description: 'existing' } }),
    ];

    const result = await resolver.resolveMany(makeConfig(), tasks);

    expect(result).toEqual([
      { kind: 'DISCLOSURE', description: 'good' },
      { kind: 'CLASSIFICATION_FAILED', description: 'bad' },
      { kind: 'AUTHENTICATION', description: 'existing' },
    ]);
  });
});
