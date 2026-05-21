import type { z } from 'zod';
import type { QaToolContext } from './qa-tool-context.js';

export interface QaTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema?: z.ZodType<O>;
  internalOnly?: boolean;
  execute(input: I, context: QaToolContext): Promise<O>;
}

export interface QaToolDescriptor {
  name: string;
  description: string;
  internalOnly: boolean;
}
