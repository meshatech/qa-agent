import { DynamicStructuredTool } from '@langchain/core/tools';

import type { QaTool, QaToolContext } from '../../application/tools/index.js';

export interface LangChainToolAdapterOptions {
  includeInternal?: boolean;
  context?: QaToolContext | (() => QaToolContext | Promise<QaToolContext>);
}

export function toLangChainTool(tool: QaTool, options: LangChainToolAdapterOptions = {}): DynamicStructuredTool | undefined {
  if (tool.internalOnly && !options.includeInternal) return undefined;

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
    func: async (input: unknown): Promise<unknown> => {
      const parsedInput = tool.inputSchema.parse(input);
      const output = await tool.execute(parsedInput, await resolveContext(options.context));
      const parsedOutput = tool.outputSchema ? tool.outputSchema.parse(output) : output;
      return toSerializable(parsedOutput);
    },
  });
}

async function resolveContext(context: LangChainToolAdapterOptions['context']): Promise<QaToolContext> {
  if (!context) return {};
  return typeof context === 'function' ? context() : context;
}

function toSerializable(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)));
}
