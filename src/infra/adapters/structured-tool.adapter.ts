import type { QaTool, QaToolContext } from '../../application/tools/index.js';

export interface StructuredToolLike {
  name: string;
  description: string;
  schema: unknown;
  invoke(input: unknown): Promise<unknown>;
}

export interface StructuredToolAdapterOptions {
  includeInternal?: boolean;
  context?: QaToolContext | (() => QaToolContext | Promise<QaToolContext>);
}

export function toStructuredToolLike(tool: QaTool, options: StructuredToolAdapterOptions = {}): StructuredToolLike | undefined {
  if (tool.internalOnly && !options.includeInternal) return undefined;

  return {
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
    async invoke(input: unknown): Promise<unknown> {
      const parsedInput = tool.inputSchema.parse(input);
      const output = await tool.execute(parsedInput, await resolveContext(options.context));
      const parsedOutput = tool.outputSchema ? tool.outputSchema.parse(output) : output;
      return toSerializable(parsedOutput);
    },
  };
}

async function resolveContext(context: StructuredToolAdapterOptions['context']): Promise<QaToolContext> {
  if (!context) return {};
  return typeof context === 'function' ? context() : context;
}

function toSerializable(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)));
}
