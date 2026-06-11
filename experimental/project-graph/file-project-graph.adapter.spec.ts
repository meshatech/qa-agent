import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileProjectGraphAdapter } from '../src/infra/persistence/file-project-graph.adapter.js';
import type { ProjectGraphExperience } from '../src/domain/schemas/project-graph.schema.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'graph-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('JsonFileProjectGraphAdapter', () => {
  it('loads empty graph when file does not exist', async () => {
    const adapter = new JsonFileProjectGraphAdapter();
    const graph = await adapter.load(tmpDir);
    expect(graph.version).toBe('graph.v1');
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('saves and loads graph roundtrip', async () => {
    const adapter = new JsonFileProjectGraphAdapter();
    const exp: ProjectGraphExperience = {
      outcomeKind: 'LOGIN',
      validatedLocators: [{ strategy: 'text', text: 'Entrar' }],
      expectedStates: [],
      successCount: 3,
      failureCount: 1,
    };
    await adapter.recordExperience(tmpDir, exp);

    const graph = await adapter.load(tmpDir);
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0].id).toBe('outcome:LOGIN');
    expect(graph.nodes[0].hits).toBe(3);
    expect(graph.nodes[0].misses).toBe(1);
  });

  it('updates existing node on recordExperience', async () => {
    const adapter = new JsonFileProjectGraphAdapter();
    const exp: ProjectGraphExperience = {
      outcomeKind: 'LOGIN',
      validatedLocators: [{ strategy: 'text', text: 'Entrar' }],
      expectedStates: [],
      successCount: 1,
      failureCount: 0,
    };
    await adapter.recordExperience(tmpDir, exp);
    await adapter.recordExperience(tmpDir, { ...exp, successCount: 2, failureCount: 1 });

    const nodes = await adapter.query(tmpDir, 'outcome');
    expect(nodes[0].hits).toBe(3);
    expect(nodes[0].misses).toBe(1);
  });

  it('filters nodes by kind in query', async () => {
    const adapter = new JsonFileProjectGraphAdapter();
    const exp: ProjectGraphExperience = { outcomeKind: 'TEST', validatedLocators: [], expectedStates: [], successCount: 1, failureCount: 0 };
    await adapter.recordExperience(tmpDir, exp);

    const outcomes = await adapter.query(tmpDir, 'outcome');
    expect(outcomes.length).toBe(1);

    const components = await adapter.query(tmpDir, 'component');
    expect(components.length).toBe(0);
  });
});
