import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';

export interface DemandContextWriterPort {
  write(runDir: string, demand: DemandContext): Promise<string>;
}
