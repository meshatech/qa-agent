import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { QaToolRegistry } from '../src/application/tools/qa-tool-registry.js';
import type { QaTool } from '../src/application/tools/qa-tool.js';
import { ALL_QA_TOOLS, INTERNAL_QA_TOOLS, PUBLIC_QA_TOOLS, PlanValidationTool } from '../src/application/tools/built-in/index.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

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

  it('validates tool output when outputSchema is defined', async () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      async execute() {
        return { echoed: 1 } as unknown as { echoed: string };
      },
    }]);

    await expect(registry.execute('qa.echo', { message: 'ok' }, {})).rejects.toThrow();
  });

  it('passes controlled QaToolContext to tool execution', async () => {
    const contextTool: QaTool<{ message: string }, { echoed: string; context: Record<string, unknown> }> = {
      name: 'qa.context.echo',
      description: 'Echo context test tool',
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({
        echoed: z.string(),
        context: z.record(z.string(), z.unknown()),
      }),
      async execute(input, context) {
        return {
          echoed: input.message,
          context: {
            runId: context.runId,
            runDir: context.runDir,
            scenarioId: context.scenarioId,
            taskId: context.taskId,
            hasConfig: Boolean(context.config),
            metadataKeys: Object.keys(context.metadata ?? {}),
          },
        };
      },
    };
    const registry = new QaToolRegistry([contextTool]);
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
    });

    await expect(registry.execute('qa.context.echo', { message: 'ok' }, {
      runId: 'run-1',
      runDir: '.agent-qa/runs/run-1',
      scenarioId: 'scenario-001',
      taskId: 'T001',
      config,
      metadata: { service: { name: 'controlled' } },
    })).resolves.toEqual({
      echoed: 'ok',
      context: {
        runId: 'run-1',
        runDir: '.agent-qa/runs/run-1',
        scenarioId: 'scenario-001',
        taskId: 'T001',
        hasConfig: true,
        metadataKeys: ['service'],
      },
    });
  });

  it('requires name, description, inputSchema, and execute for registered tools', () => {
    expect(() => new QaToolRegistry([{ ...echoTool, name: '   ' }])).toThrow(/name is required/);
    expect(() => new QaToolRegistry([{ ...echoTool, description: '   ' }])).toThrow(/description is required/);
    expect(() => new QaToolRegistry([{ ...echoTool, inputSchema: undefined as unknown as QaTool['inputSchema'] }])).toThrow(/inputSchema is required/);
    expect(() => new QaToolRegistry([{ ...echoTool, execute: undefined as unknown as QaTool['execute'] }])).toThrow(/execute is required/);
  });

  it('hides internal tools unless explicitly requested', () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    }]);

    expect(registry.list()).toEqual([]);
    expect(registry.listPublic()).toEqual([]);
    expect(registry.get('qa.internal.echo')).toBeUndefined();
    expect(registry.list({ includeInternal: true })).toEqual([{ name: 'qa.internal.echo', description: 'Echo test tool', internalOnly: true }]);
    expect(registry.listAll()).toEqual([{ name: 'qa.internal.echo', description: 'Echo test tool', internalOnly: true }]);
    expect(registry.get('qa.internal.echo', { includeInternal: true })).toBeDefined();
  });

  it('gets tools by name without exposing internal tools by default', () => {
    const internalTool: QaTool<{ message: string }, { echoed: string }> = {
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    };
    const registry = new QaToolRegistry([echoTool, internalTool]);

    expect(registry.get('qa.echo')).toBe(echoTool);
    expect(registry.get('qa.missing')).toBeUndefined();
    expect(registry.get('qa.internal.echo')).toBeUndefined();
    expect(registry.get('qa.internal.echo', { includeInternal: true })).toBe(internalTool);
  });

  it('checks tool presence without exposing internal tools by default', () => {
    const registry = new QaToolRegistry([echoTool, {
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    }]);

    expect(registry.has('qa.echo')).toBe(true);
    expect(registry.has('qa.missing')).toBe(false);
    expect(registry.has('qa.internal.echo')).toBe(false);
    expect(registry.has('qa.internal.echo', { includeInternal: true })).toBe(true);
  });

  it('gets or throws accessible tools by name with an explicit error', () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    }]);

    expect(() => registry.getOrThrow('qa.missing')).toThrow(/not found or not accessible/);
    expect(() => registry.getOrThrow('qa.internal.echo')).toThrow(/not found or not accessible/);
    expect(registry.getOrThrow('qa.internal.echo', { includeInternal: true })).toBeDefined();
  });

  it('keeps require as an alias for getOrThrow', () => {
    const registry = new QaToolRegistry([{
      ...echoTool,
      name: 'qa.internal.echo',
      internalOnly: true,
    }]);

    expect(() => registry.require('qa.missing')).toThrow(/not found or not accessible/);
    expect(() => registry.require('qa.internal.echo')).toThrow(/not found or not accessible/);
    expect(registry.require('qa.internal.echo', { includeInternal: true })).toBeDefined();
  });

  it('rejects duplicate tool names', () => {
    const registry = new QaToolRegistry([echoTool]);

    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });

  it('rejects public direct Playwright action tool names', () => {
    for (const name of [
      'click',
      'fill',
      'press',
      'navigate',
      'selectOption',
      'uploadFile',
      'dragAndDrop',
      'evaluate',
      'playwright.click',
      'playwright.fill',
      'playwright.press',
      'playwright.navigate',
      'playwright.selectOption',
      'playwright.uploadFile',
      'playwright.dragAndDrop',
      'playwright.evaluate',
    ]) {
      expect(() => new QaToolRegistry([{
        ...echoTool,
        name,
        description: `Unsafe public ${name}`,
      }])).toThrow(/Direct Playwright action/);
    }
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

  it('registers the initial public macro tool catalog', () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);
    const names = registry.list().map((tool) => tool.name);

    expect(names).toEqual([
      'qa.evidence.record',
      'qa.memory.search',
      'qa.plan.build',
      'qa.plan.execute',
      'qa.plan.replan',
      'qa.plan.validate',
      'qa.report.generate',
      'qa.screen.observe',
      'qa.spec.export',
    ]);
    expect(names).not.toContain('click');
    expect(names).not.toContain('fill');
    expect(names).not.toContain('press');
    expect(names).not.toContain('navigate');
    expect(names).not.toContain('selectOption');
    expect(names).not.toContain('uploadFile');
    expect(names).not.toContain('dragAndDrop');
    expect(names).not.toContain('evaluate');
    expect(names).not.toContain('playwright.click');
    expect(names).not.toContain('playwright.fill');
    expect(names).not.toContain('playwright.press');
    expect(names).not.toContain('playwright.navigate');
    expect(names).not.toContain('playwright.selectOption');
    expect(names).not.toContain('playwright.uploadFile');
    expect(names).not.toContain('playwright.dragAndDrop');
    expect(names).not.toContain('playwright.evaluate');
    expect(PUBLIC_QA_TOOLS.every((tool) => !tool.internalOnly)).toBe(true);
  });

  it('registers internal tools as internalOnly and hides them by default', () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);
    const internalNames = INTERNAL_QA_TOOLS.map((tool) => tool.name).sort();

    expect(INTERNAL_QA_TOOLS.every((tool) => tool.internalOnly)).toBe(true);
    expect(registry.list().some((tool) => internalNames.includes(tool.name))).toBe(false);
    expect(registry.listPublic().some((tool) => internalNames.includes(tool.name))).toBe(false);
    expect(registry.list({ includeInternal: true }).filter((tool) => tool.internalOnly).map((tool) => tool.name).sort()).toEqual(internalNames);
    expect(registry.listAll().filter((tool) => tool.internalOnly).map((tool) => tool.name).sort()).toEqual(internalNames);
  });

  it('delegates qa.plan.build to ExecutionPlanPlannerService from context', async () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
    });
    const result = await registry.execute('qa.plan.build', { config, scenarios: [] }, {
      metadata: {
        executionPlanPlanner: {
          async build() {
            return {
              source: 'factory',
              plan: {
                schemaVersion: 'execution-plan.v1',
                planId: 'plan-D1',
                version: 1,
                goal: 'Smoke',
                mode: 'HYBRID_GUARDED',
                runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
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
              },
            };
          },
        },
      },
    });

    expect(result).toMatchObject({ ok: true, result: { planSource: 'factory', plan: { planId: 'plan-D1' } } });
  });

  it('delegates qa.plan.execute to PlanExecutorService and rejects action-only input', async () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);
    const config = RunConfigSchema.parse({
      baseUrl: 'https://app.local',
      appDomains: ['app.local'],
      demand: { id: 'D1', title: 'Smoke', description: 'Smoke' },
    });
    const plan = {
      schemaVersion: 'execution-plan.v1',
      planId: 'plan-1',
      version: 1,
      goal: 'Smoke',
      mode: 'HYBRID_GUARDED',
      runtime: { maxAttemptsPerStep: 1, maxReplansPerScenario: 0, destructiveActionPolicy: 'BLOCK' },
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

    await expect(registry.execute('qa.plan.execute', { action: { type: 'click', targetElementId: 'el_001', reason: 'bad' } }, {
      config,
      metadata: { planExecutor: { async execute() { return { ok: true }; } } },
    })).rejects.toThrow();

    await expect(registry.execute('qa.plan.execute', { config, plan }, {
      metadata: { planExecutor: { async execute() { return { ok: true, steps: [] }; } } },
    })).resolves.toMatchObject({ ok: true, result: { ok: true, steps: [] } });
  });

  it('executes internal condition evaluation only when internal access is enabled', async () => {
    const registry = new QaToolRegistry(ALL_QA_TOOLS);
    const observation = {
      observationId: 'obs-1',
      createdAt: new Date().toISOString(),
      url: 'https://app.local/inbox',
      title: 'Inbox',
      visibleTexts: ['Inbox'],
      elements: [],
      pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
      consoleSignals: [],
      networkSignals: [],
      meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    };

    await expect(registry.execute('qa.condition.evaluate', { condition: { type: 'text_visible', text: 'Inbox' }, observation }, {})).rejects.toThrow(/not accessible/);
    await expect(registry.execute('qa.condition.evaluate', { condition: { type: 'text_visible', text: 'Inbox' }, observation }, {}, { includeInternal: true })).resolves.toMatchObject({
      ok: true,
      result: { passed: true, type: 'text_visible' },
    });
  });
});
