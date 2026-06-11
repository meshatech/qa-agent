import { describe, expect, it } from 'vitest';
import {
  ToolNameSchema,
  ToolQueueSchema,
  ToolQueueItemSchema,
  FallbackToolCallSchema,
  NavigatorOpenParamsSchema,
  ActorFillParamsSchema,
} from '../src/domain/schemas/tool-queue.schema.js';

describe('ToolNameSchema', () => {
  it('accepts valid tool names', () => {
    expect(ToolNameSchema.parse('navigator.open')).toBe('navigator.open');
    expect(ToolNameSchema.parse('actor.fill')).toBe('actor.fill');
    expect(ToolNameSchema.parse('explorer.scan')).toBe('explorer.scan');
  });

  it('rejects invalid tool names', () => {
    expect(() => ToolNameSchema.parse('banana')).toThrow();
    expect(() => ToolNameSchema.parse('actor.hover')).toThrow();
    expect(() => ToolNameSchema.parse('')).toThrow();
  });
});

describe('NavigatorOpenParamsSchema', () => {
  it('accepts valid params', () => {
    expect(NavigatorOpenParamsSchema.parse({ url: 'https://codeshare.io' })).toEqual({ url: 'https://codeshare.io' });
  });

  it('accepts params with expectedTitle', () => {
    expect(NavigatorOpenParamsSchema.parse({ url: 'https://codeshare.io', expectedTitle: 'CodeShare' })).toEqual({
      url: 'https://codeshare.io',
      expectedTitle: 'CodeShare',
    });
  });

  it('rejects empty url', () => {
    expect(() => NavigatorOpenParamsSchema.parse({ url: '' })).toThrow();
  });
});

describe('ActorFillParamsSchema', () => {
  it('accepts valid fill params', () => {
    expect(
      ActorFillParamsSchema.parse({
        target: { strategy: 'text_any', texts: ['editor'] },
        value: 'teste',
      })
    ).toEqual({
      target: { strategy: 'text_any', texts: ['editor'] },
      value: 'teste',
    });
  });

  it('rejects params without target', () => {
    expect(() => ActorFillParamsSchema.parse({ value: 'teste' })).toThrow();
  });

  it('rejects params with banana field', () => {
    expect(() =>
      ActorFillParamsSchema.parse({
        target: { strategy: 'text_any', texts: ['editor'] },
        value: 'teste',
        banana: 'x',
      })
    ).toThrow();
  });
});

describe('FallbackToolCallSchema', () => {
  it('accepts valid fallback tool call', () => {
    expect(
      FallbackToolCallSchema.parse({
        tool: 'explorer.scan',
        params: { mode: 'scan_inputs' },
      })
    ).toEqual({
      tool: 'explorer.scan',
      params: { mode: 'scan_inputs' },
    });
  });

  it('rejects fallback with invalid tool', () => {
    expect(() =>
      FallbackToolCallSchema.parse({
        tool: 'banana',
        params: { url: 'test' },
      })
    ).toThrow();
  });
});

describe('ToolQueueItemSchema', () => {
  it('accepts valid navigator.open item', () => {
    const item = {
      step: 1,
      tool: 'navigator.open' as const,
      params: { url: 'https://codeshare.io' },
    };
    expect(ToolQueueItemSchema.parse(item)).toEqual(item);
  });

  it('accepts valid actor.fill item with fallback', () => {
    const item = {
      step: 2,
      tool: 'actor.fill' as const,
      params: { target: { strategy: 'text_any', texts: ['editor'] }, value: 'teste' },
      fallback: {
        tool: 'explorer.scan' as const,
        params: { mode: 'scan_inputs' },
      },
    };
    expect(ToolQueueItemSchema.parse(item)).toEqual(item);
  });

  it('rejects item with invalid tool', () => {
    expect(() =>
      ToolQueueItemSchema.parse({
        step: 1,
        tool: 'banana',
        params: {},
      })
    ).toThrow();
  });

  it('rejects actor.fill with missing value', () => {
    expect(() =>
      ToolQueueItemSchema.parse({
        step: 1,
        tool: 'actor.fill',
        params: { target: { strategy: 'text_any', texts: ['editor'] } },
      })
    ).toThrow();
  });

  it('rejects fallback with invalid params for that tool', () => {
    expect(() =>
      ToolQueueItemSchema.parse({
        step: 1,
        tool: 'actor.fill',
        params: { target: { strategy: 'text_any', texts: ['editor'] }, value: 'teste' },
        fallback: {
          tool: 'explorer.scan',
          params: { mode: 'banana' },
        },
      })
    ).toThrow();
  });
});

describe('ToolQueueSchema', () => {
  it('accepts valid queue with reasoning', () => {
    const queue = {
      taskQueue: [
        {
          step: 1,
          tool: 'navigator.open' as const,
          params: { url: 'https://codeshare.io' },
        },
        {
          step: 2,
          tool: 'observer.capture' as const,
          params: { includeAccessibilityTree: true },
        },
      ],
      reasoning: 'Open page and observe',
    };
    expect(ToolQueueSchema.parse(queue)).toEqual(queue);
  });

  it('rejects queue without reasoning', () => {
    expect(() =>
      ToolQueueSchema.parse({
        taskQueue: [{ step: 1, tool: 'navigator.open', params: { url: 'test' } }],
      })
    ).toThrow();
  });

  it('rejects queue with invalid tool in taskQueue', () => {
    expect(() =>
      ToolQueueSchema.parse({
        taskQueue: [{ step: 1, tool: 'banana', params: {} }],
        reasoning: 'test',
      })
    ).toThrow();
  });

  it('rejects queue with actor.fill missing value', () => {
    expect(() =>
      ToolQueueSchema.parse({
        taskQueue: [
          {
            step: 1,
            tool: 'actor.fill',
            params: { target: { strategy: 'text_any', texts: ['editor'] } },
          },
        ],
        reasoning: 'test',
      })
    ).toThrow();
  });
});
