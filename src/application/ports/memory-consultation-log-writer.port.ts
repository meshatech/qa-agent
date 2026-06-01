import type { MemoryConsultationLog } from '../../domain/schemas/memory-consultation-log.schema.js';

export interface MemoryConsultationLogWriterPort {
  write(outputDir: string, log: MemoryConsultationLog): Promise<string>;
}
