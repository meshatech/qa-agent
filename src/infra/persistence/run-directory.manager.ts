import { Injectable } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

@Injectable()
export class RunDirectoryManager {
  async create(config: RunConfig): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const short = randomBytes(4).toString('hex');
    const dir = join(config.output.runsDir, `${ts}__${short}`);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'bugs'), { recursive: true });
    await mkdir(join(dir, 'scenarios'), { recursive: true });
    await mkdir(join(dir, 'artifacts', 'screenshots'), { recursive: true });
    await mkdir(join(dir, 'artifacts', 'videos'), { recursive: true });
    await mkdir(join(dir, 'artifacts', 'traces'), { recursive: true });
    await mkdir(join(dir, 'artifacts', 'logs'), { recursive: true });
    return dir;
  }

  bugDir(_runDir: string, bugId: string): string {
    return `bugs/${bugId}`;
  }
}
