import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import type { QaTool } from '../src/application/tools/qa-tool.js';
import { PlanValidationTool } from '../src/application/tools/built-in/plan-validation.tool.js';

const echoTool: QaTool<{ message: string }, { echoed: string }> = {
  name: 'qa.echo',
  description: 'Echo test tool',
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  async execute(input) {
    return { echoed: input.message };
  },
};

describe('QaToolRegistry', () => {
  it('registers, lists, and executes a public tool with Zod validation', async () => {
    const registry = new QaToolRegistry([echoTool]);

    expect(registry.list()).toEqual([{ name: 'qa.echo', description: 'Echo test tool', internalOnly: false }]);
    await expect(registry.execute('qa.echo', { message: 'ok' }, {})).resolves.toEqual({ echoed: 'ok' });
    await expect(registry.execute('qa.echo', { message: 1 }, {})).rejects.toThrow();
  });

  it('hides internal tools unless explicitly requested', () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    }]);

    expect(registry.list()).toEqual([]);
    expect(registry.get('qa.internal.echo')).toBeUndefined();
    expect(registry.list({ includeInternal: true })).toEqual([{ name: 'qa.internal.echo', description: 'Echo test tool', internalOnly: true }]);
    expect(registry.get('qa.internal.echo', { includeInternal: true })).toBeDefined();
  });

  it('rejects duplicate tool names', () => {
    const registry = new QaToolRegistry([echoTool]);

    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });

  it('rejects public direct Playwright action tools', () => {
    expect(() => new QaToolRegistry([{
      ...echoTool,
      name: 'click',
      description: 'Unsafe public click',
    }])).toThrow(/Direct Playwright action/);
  });

  it('allows direct action names only when internal', () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      name: 'click',
      description: 'Internal click wrapper',
      internalOnly: true,
    }]);

    expect(registry.list()).toEqual([]);
    expect(registry.get('click', { includeInternal: true })).toBeDefined();
  });

  it('registers many tools at once', () => {
    const registry = new QaToolRegistry();

    registry.registerMany([echoTool]);

    expect(registry.get('qa.echo')).toBeDefined();
  });

  it('validates an ExecutionPlan through the public plan validation tool', async () => {
    const registry = new QaToolRegistry([PlanValidationTool]);
    const plan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan-1',
      version: 1,
      goal: 'Smoke',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 2, maxReplansPerScenario: 1, destructiveActionPolicy: 'BLOCK' },
      steps: [{
        id: 'S001',
        description: 'Wait',
        preconditions: [],
        action: { type: 'waitForStable', reason: 'wait for stable UI' },
        postconditions: [{ type: 'text_visible', text: 'Inbox' }],
        assertions: [],
        onFailure: 'RECOVER',
      }],
      assertions: [],
    };

    await expect(registry.execute('qa.plan.validate', { plan }, {})).resolves.toEqual({ ok: true, issues: [] });
  });

  it('reports ExecutionPlan validation issues without executing browser actions', async () => {
    const registry = new QaToolRegistry([PlanValidationTool]);
    const result = await registry.execute('qa.plan.validate', {
      plan: {
        planId: 'bad',
        goal: 'Bad',
        steps: [{
          id: 'S001',
          description: 'Bad',
          action: { type: 'click', targetElementId: 'el_001', reason: 'bad' },
          postconditions: [{ type: 'text_visible', text: 'Done' }],
        }],
      },
    }, {});

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('targetElementId');
  });
});
