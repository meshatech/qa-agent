import { isLangChainTool } from '@langchain/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { QaTool } from '../src/application/tools/qa-tool.js';
import { toLangChainTool } from '../src/infra/adapters/langchain-tool.adapter.js';

const publicTool: QaTool<{ message: string }, { echoed: string; runId?: string }> = {
  name: 'qa.echo',
  description: 'Echo public tool',
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ echoed: z.string(), runId: z.string().optional() }),
  async execute(input, context) {
    return { echoed: input.message, runId: context.runId };
  },
};

describe('LangChain tool adapter', () => {
  it('converts a public QaTool to a real LangChain structured tool', async () => {
    const tool = toLangChainTool(publicTool, { context: { runId: 'run-1' } });

    expect(tool).toBeDefined();
    expect(isLangChainTool(tool)).toBe(true);
    expect(tool?.name).toBe('qa.echo');
    expect(tool?.description).toBe('Echo public tool');
    expect(tool?.schema).toBe(publicTool.inputSchema);
    await expect(tool?.invoke({ message: 'ok' })).resolves.toEqual({ echoed: 'ok', runId: 'run-1' });
  });

  it('does not convert internal tools by default', () => {
    const tool = toLangChainTool({ ...publicTool, internalOnly: true });

    expect(tool).toBeUndefined();
  });

  it('can convert internal tools only when explicitly allowed', async () => {
    const tool = toLangChainTool({ ...publicTool, internalOnly: true }, { includeInternal: true });

    expect(tool).toBeDefined();
    await expect(tool?.invoke({ message: 'internal' })).resolves.toEqual({ echoed: 'internal' });
  });

  it('validates input before invoking the QaTool', async () => {
    const tool = toLangChainTool(publicTool);

    await expect(tool?.invoke({ message: 1 })).rejects.toThrow();
  });
});
