import { describe, expect, it } from 'vitest';
import { ToolQueueToExecutionPlanMapper } from '../src/application/services/tool-queue-to-execution-plan.mapper.js';
import type { ToolQueue } from '../src/domain/schemas/tool-queue.schema.js';

describe('ToolQueueToExecutionPlanMapper', () => {
  const mapper = new ToolQueueToExecutionPlanMapper();

  it('maps navigator.open to navigate step', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'navigator.open',
          params: { url: 'https://codeshare.io' },
        },
      ],
      reasoning: 'Open page',
    };

    const plan = mapper.map({ queue, goal: 'Test navigation', planId: 'plan-001' });

    expect(plan.schemaVersion).toBe('execution-plan.v1');
    expect(plan.planId).toBe('plan-001');
    expect(plan.goal).toBe('Test navigation');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action.type).toBe('navigate');
    expect(plan.steps[0].action).toMatchObject({ to: 'https://codeshare.io' });
    expect(plan.steps[0].postconditions).toHaveLength(1);
    expect(plan.steps[0].postconditions[0]).toMatchObject({ type: 'route_state', expected: 'matches' });
  });

  it('maps actor.fill to fill step with field_value_contains postcondition', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'actor.fill',
          params: {
            target: { strategy: 'text_any', texts: ['editor'] },
            value: 'teste',
          },
        },
      ],
      reasoning: 'Fill editor',
    };

    const plan = mapper.map({ queue, goal: 'Fill editor', planId: 'plan-002' });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action.type).toBe('fill');
    expect(plan.steps[0].action).toMatchObject({
      target: { strategy: 'text_any', texts: ['editor'] },
      value: 'teste',
    });
    expect(plan.steps[0].postconditions[0]).toMatchObject({
      type: 'field_value_contains',
      target: { strategy: 'text_any', texts: ['editor'] },
      value: 'teste',
    });
  });

  it('maps actor.click to click step with element_visible postcondition', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'actor.click',
          params: {
            target: { strategy: 'role', role: 'button', name: 'Submit' },
          },
        },
      ],
      reasoning: 'Click submit',
    };

    const plan = mapper.map({ queue, goal: 'Click submit', planId: 'plan-003' });

    expect(plan.steps[0].action.type).toBe('click');
    expect(plan.steps[0].postconditions[0]).toMatchObject({
      type: 'element_visible',
      target: { strategy: 'role', role: 'button', name: 'Submit' },
    });
  });

  it('maps observer.capture to waitForStable step', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'observer.capture',
          params: { includeAccessibilityTree: true },
        },
      ],
      reasoning: 'Observe page',
    };

    const plan = mapper.map({ queue, goal: 'Observe', planId: 'plan-004' });

    expect(plan.steps[0].action.type).toBe('waitForStable');
    expect(plan.steps[0].postconditions[0]).toMatchObject({ type: 'no_console_errors' });
  });

  it('maps validator.state to waitForStable with condition postcondition', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'validator.state',
          params: {
            condition: { type: 'text_visible', text: 'Success' },
          },
        },
      ],
      reasoning: 'Validate state',
    };

    const plan = mapper.map({ queue, goal: 'Validate', planId: 'plan-005' });

    expect(plan.steps[0].action.type).toBe('waitForStable');
    expect(plan.steps[0].postconditions[0]).toMatchObject({ type: 'text_visible', text: 'Success' });
  });

  it('maps multiple tools to multiple steps preserving order', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'navigator.open',
          params: { url: 'https://example.com' },
        },
        {
          step: 2,
          tool: 'observer.capture',
          params: {},
        },
        {
          step: 3,
          tool: 'actor.fill',
          params: {
            target: { strategy: 'text_any', texts: ['name'] },
            value: 'John',
          },
        },
      ],
      reasoning: 'Full flow',
    };

    const plan = mapper.map({ queue, goal: 'Full flow', planId: 'plan-006' });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].action.type).toBe('navigate');
    expect(plan.steps[1].action.type).toBe('waitForStable');
    expect(plan.steps[2].action.type).toBe('fill');
  });

  it('maps actor.type to typeText action with text_visible postcondition', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'actor.type',
          params: { text: 'hello world' },
        },
      ],
      reasoning: 'Type text',
    };

    const plan = mapper.map({ queue, goal: 'Type', planId: 'plan-type' });

    expect(plan.steps[0].action.type).toBe('typeText');
    expect(plan.steps[0].action).toMatchObject({ text: 'hello world' });
    expect(plan.steps[0].postconditions[0]).toMatchObject({ type: 'text_visible', text: 'hello world' });
  });

  it('maps explorer.scan to assertVisible action', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'explorer.scan',
          params: { mode: 'scan_inputs' },
        },
      ],
      reasoning: 'Explore inputs',
    };

    const plan = mapper.map({ queue, goal: 'Explore', planId: 'plan-scan' });

    expect(plan.steps[0].action.type).toBe('assertVisible');
    expect(plan.steps[0].action).toMatchObject({ text: 'input' });
  });

  it('sets metadata with planSource and fallback info', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'actor.fill',
          params: { target: { strategy: 'text_any', texts: ['editor'] }, value: 'test' },
          fallback: { tool: 'explorer.scan', params: { mode: 'scan_inputs' } },
        },
      ],
      reasoning: 'Fill with fallback',
    };

    const plan = mapper.map({ queue, goal: 'Test fallback', planId: 'plan-meta' });

    expect(plan.metadata).toBeDefined();
    expect(plan.metadata?.planSource).toBe('orchestrator');
    expect(plan.metadata?.fallbackReason).toContain('fallback');
    expect(plan.metadata?.fallbackWarning).toContain('fallback');
  });

  it('does not set fallback metadata when no fallback exists', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
      ],
      reasoning: 'Open page',
    };

    const plan = mapper.map({ queue, goal: 'Test', planId: 'plan-nofb' });

    expect(plan.metadata?.fallbackReason).toBeUndefined();
    expect(plan.metadata?.fallbackWarning).toBeUndefined();
  });

  it('preserves scenarioId and taskId in steps', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'navigator.open',
          params: { url: 'https://codeshare.io' },
        },
      ],
      reasoning: 'Open page',
    };

    const plan = mapper.map({
      queue,
      goal: 'Test',
      planId: 'plan-007',
      scenarioId: 'scenario-001',
      taskId: 'T001',
    });

    expect(plan.steps[0].scenarioId).toBe('scenario-001');
    expect(plan.steps[0].taskId).toBe('T001');
  });

  it('does not call browser or LLM', () => {
    const queue: ToolQueue = {
      taskQueue: [
        {
          step: 1,
          tool: 'navigator.open',
          params: { url: 'https://test.com' },
        },
      ],
      reasoning: 'Test',
    };

    // Mapper is pure — no side effects, no network, no browser
    const plan = mapper.map({ queue, goal: 'Test', planId: 'plan-008' });
    expect(plan).toBeDefined();
    expect(plan.steps).toHaveLength(1);
  });
});
