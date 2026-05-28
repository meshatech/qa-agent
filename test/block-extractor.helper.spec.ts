import { describe, expect, it } from 'vitest';
import { extractBlocksFromResult } from '../src/application/services/block-extractor.helper.js';
import type { QaRunResult } from '../src/domain/models/run.model.js';

function makeResult(overrides: Partial<QaRunResult> = {}): QaRunResult {
  return {
    status: 'PASSED',
    runDir: '/tmp/run-001',
    steps: [],
    scenarios: [],
    ...overrides,
  };
}

describe('extractBlocksFromResult', () => {
  it('returns empty array when no blocks exist', () => {
    const result = makeResult();
    expect(extractBlocksFromResult(result)).toEqual([]);
  });

  it('extracts scenario with BLOCKED status', () => {
    const result = makeResult({
      scenarios: [{
        id: 'SCN-01',
        title: 'Checkout',
        status: 'BLOCKED',
        tasks: [],
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      scenarioId: 'SCN-01',
      scenarioTitle: 'Checkout',
      source: 'scenario',
      reason: 'Scenario blocked: Checkout',
    });
  });

  it('extracts task with BLOCKED status', () => {
    const result = makeResult({
      scenarios: [{
        id: 'SCN-01',
        title: 'Checkout',
        status: 'PLANNED',
        tasks: [{
          id: 'TSK-01',
          title: 'Confirm payment',
          status: 'BLOCKED',
          expected: 'Payment confirmed',
        }],
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      scenarioId: 'SCN-01',
      taskId: 'TSK-01',
      source: 'task',
      reason: 'Task blocked: Confirm payment',
    });
  });

  it('extracts step with blocked error code', () => {
    const result = makeResult({
      steps: [{
        stepId: 'STP-01',
        scenarioId: 'SCN-01',
        taskId: 'TSK-01',
        action: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        resolvedAction: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        boundExpected: { type: 'field_value_contains', target: { type: 'css', value: '#msg' }, value: 'Done' } as unknown as import('../src/domain/schemas/action.schema.js').BoundExpectedAfterAction,
        error: { code: 'TASK_DEPENDENCY_BLOCKED', message: 'Previous task not completed' },
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      scenarioId: 'SCN-01',
      taskId: 'TSK-01',
      stepId: 'STP-01',
      code: 'TASK_DEPENDENCY_BLOCKED',
      source: 'step',
      reason: 'TASK_DEPENDENCY_BLOCKED: Previous task not completed',
    });
  });

  it('ignores step with non-block error code', () => {
    const result = makeResult({
      steps: [{
        stepId: 'STP-01',
        action: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        resolvedAction: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        boundExpected: { type: 'field_value_contains', target: { type: 'css', value: '#msg' }, value: 'Done' } as unknown as import('../src/domain/schemas/action.schema.js').BoundExpectedAfterAction,
        error: { code: 'LOCATOR_NOT_FOUND', message: 'Button not found' },
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toEqual([]);
  });

  it('deduplicates identical blocks', () => {
    const result = makeResult({
      scenarios: [{
        id: 'SCN-01',
        title: 'Checkout',
        status: 'BLOCKED',
        tasks: [{
          id: 'TSK-01',
          title: 'Confirm payment',
          status: 'BLOCKED',
          expected: 'Payment confirmed',
        }],
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toHaveLength(2);
    // scenario block + task block are different, both should appear
    expect(blocks.some((b) => b.source === 'scenario')).toBe(true);
    expect(blocks.some((b) => b.source === 'task')).toBe(true);
  });

  it('does not deduplicate different blocks', () => {
    const result = makeResult({
      scenarios: [
        {
          id: 'SCN-01',
          title: 'Checkout',
          status: 'BLOCKED',
          tasks: [],
        },
        {
          id: 'SCN-02',
          title: 'Login',
          status: 'BLOCKED',
          tasks: [],
        },
      ],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].scenarioId).toBe('SCN-01');
    expect(blocks[1].scenarioId).toBe('SCN-02');
  });

  it('handles missing scenario title with fallback', () => {
    const result = makeResult({
      scenarios: [{
        id: 'SCN-01',
        title: '',
        status: 'BLOCKED',
        tasks: [],
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks[0].reason).toBe('Scenario blocked: Untitled scenario');
  });

  it('handles missing task title with fallback', () => {
    const result = makeResult({
      scenarios: [{
        id: 'SCN-01',
        title: 'Checkout',
        status: 'PLANNED',
        tasks: [{
          id: 'TSK-01',
          title: '',
          status: 'BLOCKED',
          expected: 'Ok',
        }],
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks[0].reason).toBe('Task blocked: Untitled task');
  });

  it('handles step with missing message', () => {
    const result = makeResult({
      steps: [{
        stepId: 'STP-01',
        action: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        resolvedAction: { type: 'click', targetElementId: 'btn', reason: 'Click button' } as unknown as import('../src/domain/schemas/action.schema.js').QaAction,
        boundExpected: { type: 'field_value_contains', target: { type: 'css', value: '#msg' }, value: 'Done' } as unknown as import('../src/domain/schemas/action.schema.js').BoundExpectedAfterAction,
        error: { code: 'NAVIGATION_BLOCKED', message: '' },
      }],
    });
    const blocks = extractBlocksFromResult(result);
    expect(blocks[0].reason).toBe('NAVIGATION_BLOCKED: No message');
  });
});
