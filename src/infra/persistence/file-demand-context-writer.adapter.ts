import { Injectable } from '@nestjs/common';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DemandContextWriterPort } from '../../application/ports/demand-context-writer.port.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';

const DEMAND_CONTEXT_FILE = 'demand-context.json';

@Injectable()
export class FileDemandContextWriterAdapter implements DemandContextWriterPort {
  async write(runDir: string, demand: DemandContext): Promise<string> {
    await mkdir(runDir, { recursive: true });
    const path = resolve(join(runDir, DEMAND_CONTEXT_FILE));
    const tmpPath = `${path}.tmp`;
    const payload = JSON.stringify(demand, null, 2);
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, path);
    return path;
  }
}
