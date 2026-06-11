import { describe, expect, it } from 'vitest';
import {
  ReplanActionSchema,
  ReplanQueueSchema,
} from '../src/domain/schemas/replan-queue.schema.js';

describe('ReplanActionSchema', () => {
  it('accepts replace_remaining_steps', () => {
    expect(ReplanActionSchema.parse('replace_remaining_steps')).toBe('replace_remaining_steps');
  });

  it('accepts abort', () => {
    expect(ReplanActionSchema.parse('abort')).toBe('abort');
  });

  it('rejects invalid action', () => {
    expect(() => ReplanActionSchema.parse('full_replan')).toThrow();
    expect(() => ReplanActionSchema.parse('')).toThrow();
  });
});

describe('ReplanQueueSchema', () => {
  it('accepts replace_remaining_steps with fromStep and taskQueue', () => {
    const replan = {
      action: 'replace_remaining_steps' as const,
      fromStep: 4,
      taskQueue: [
        {
          step: 4,
          tool: 'explorer.scan' as const,
          params: { mode: 'scan_inputs' },
        },
      ],
      reasoning: 'Locator failed, scan inputs first',
    };
    expect(ReplanQueueSchema.parse(replan)).toEqual(replan);
  });

  it('accepts abort without fromStep or taskQueue', () => {
    const replan = {
      action: 'abort' as const,
      reasoning: 'No reliable locator found',
    };
    expect(ReplanQueueSchema.parse(replan)).toEqual(replan);
  });

  it('replaces abort with fromStep', () => {
    const replan = {
      action: 'abort' as const,
      fromStep: 3,
      reasoning: 'No reliable locator found',
    };
    expect(ReplanQueueSchema.parse(replan)).toEqual(replan);
  });

  it('rejects replace_remaining_steps without fromStep', () => {
    expect(() =>
      ReplanQueueSchema.parse({
        action: 'replace_remaining_steps',
        reasoning: 'test',
      })
    ).toThrow();
  });

  it('rejects tool outside ToolNameSchema in taskQueue', () => {
    expect(() =>
      ReplanQueueSchema.parse({
        action: 'replace_remaining_steps',
        fromStep: 2,
        taskQueue: [
          {
            step: 2,
            tool: 'banana',
            params: {},
          },
        ],
        reasoning: 'test',
      })
    ).toThrow();
  });

  it('rejects missing reasoning', () => {
    expect(() =>
      ReplanQueueSchema.parse({
        action: 'abort',
      })
    ).toThrow();
  });
});
