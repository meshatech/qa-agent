import { describe, expect, it } from 'vitest';
import { ToolQueueExecutionRecorderService } from '../src/application/services/tool-queue-execution-recorder.service.js';
import type { ToolQueue } from '../src/domain/schemas/tool-queue.schema.js';
import type { ToolResult } from '../src/domain/schemas/tool-result.schema.js';

describe('ToolQueueExecutionRecorderService', () => {
  const recorder = new ToolQueueExecutionRecorderService();

  it('records successful execution', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
        { step: 2, tool: 'actor.fill', params: { target: { strategy: 'text_any', texts: ['name'] }, value: 'John' } },
      ],
      reasoning: 'Fill form',
    };

    const results: ToolResult[] = [
      { ok: true, tool: 'navigator.open', durationMs: 500 },
      { ok: true, tool: 'actor.fill', durationMs: 200 },
    ];

    const report = recorder.record('plan-001', queue, results);

    expect(report.planId).toBe('plan-001');
    expect(report.totalSteps).toBe(2);
    expect(report.passedSteps).toBe(2);
    expect(report.failedSteps).toBe(0);
    expect(report.hasBlocks).toBe(false);
    expect(report.hasBugs).toBe(false);
    expect(report.records[0].step).toBe(1);
    expect(report.records[1].step).toBe(2);
  });

  it('records failed execution as blocked', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
        { step: 2, tool: 'actor.click', params: { target: { strategy: 'text_any', texts: ['submit'] } } },
      ],
      reasoning: 'Click submit',
    };

    const results: ToolResult[] = [
      { ok: true, tool: 'navigator.open', durationMs: 300 },
      { ok: false, tool: 'actor.click', durationMs: 100, error: { code: 'LOCATOR_NOT_FOUND', message: 'Element not found' } },
    ];

    const report = recorder.record('plan-002', queue, results);

    expect(report.totalSteps).toBe(2);
    expect(report.passedSteps).toBe(1);
    expect(report.failedSteps).toBe(1);
    expect(report.hasBlocks).toBe(true);
    expect(report.hasBugs).toBe(true);
    expect(report.records[1].errorCode).toBe('LOCATOR_NOT_FOUND');
  });

  it('records fallback usage', () => {
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

    const results: ToolResult[] = [
      { ok: true, tool: 'actor.fill', durationMs: 150 },
    ];

    const report = recorder.record('plan-003', queue, results);

    expect(report.fallbackSteps).toBe(1);
    expect(report.records[0].fallbackUsed).toBe(true);
  });

  it('generates markdown report', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
        { step: 2, tool: 'actor.click', params: { target: { strategy: 'text_any', texts: ['submit'] } } },
      ],
      reasoning: 'Test',
    };

    const results: ToolResult[] = [
      { ok: true, tool: 'navigator.open', durationMs: 300 },
      { ok: false, tool: 'actor.click', durationMs: 100, error: { code: 'CLICK_FAILED', message: 'Timeout' } },
    ];

    const report = recorder.record('plan-004', queue, results);
    const md = recorder.toMarkdown(report);

    expect(md).toContain('# ToolQueue Execution Report');
    expect(md).toContain('BLOCKED');
    expect(md).toContain('| 1 | navigator.open | PASS |');
    expect(md).toContain('| 2 | actor.click | FAIL |');
    expect(md).toContain('## Bugs');
    expect(md).toContain('CLICK_FAILED');
    expect(md).toContain('## Blocks');
  });

  it('handles missing results gracefully', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
      ],
      reasoning: 'Test',
    };

    const results: ToolResult[] = [];

    const report = recorder.record('plan-005', queue, results);

    expect(report.passedSteps).toBe(0);
    expect(report.failedSteps).toBe(1);
    expect(report.records[0].ok).toBe(false);
  });

  it('does not call browser or LLM', () => {
    const queue: ToolQueue = {
      taskQueue: [
        { step: 1, tool: 'navigator.open', params: { url: 'https://example.com' } },
      ],
      reasoning: 'Test',
    };

    const results: ToolResult[] = [{ ok: true, tool: 'navigator.open', durationMs: 100 }];

    const report = recorder.record('plan-006', queue, results);

    expect(report).toBeDefined();
    expect(report.records).toHaveLength(1);
  });
});
