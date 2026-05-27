import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

export interface PrDiffContextWriterPort {
  write(outputDir: string, context: PrDiffContext): Promise<string>;
}
