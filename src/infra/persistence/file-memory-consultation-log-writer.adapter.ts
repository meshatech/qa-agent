import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { MemoryConsultationLogWriterPort } from '../../application/ports/memory-consultation-log-writer.port.js';
import type { MemoryConsultationLog } from '../../domain/schemas/memory-consultation-log.schema.js';
import { commitAtomicJsonWrite } from './atomic-json-write.js';

const MEMORY_CONSULTATION_LOG_FILE = 'memory-consultation-log.json';

@Injectable()
export class FileMemoryConsultationLogWriterAdapter implements MemoryConsultationLogWriterPort {
  async write(outputDir: string, log: MemoryConsultationLog): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const path = resolve(join(outputDir, MEMORY_CONSULTATION_LOG_FILE));
    const tmpPath = `${path}.tmp`;
    const payload = JSON.stringify(log, null, 2);

    await writeFile(tmpPath, payload, 'utf8');
    await commitAtomicJsonWrite(tmpPath, path);

    return path;
  }
}
