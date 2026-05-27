import { Injectable } from '@nestjs/common';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PrDiffContextWriterPort } from '../../application/ports/pr-diff-context-writer.port.js';
import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';

const PR_DIFF_CONTEXT_FILE = 'pr-diff-context.json';

@Injectable()
export class FilePrDiffContextWriterAdapter implements PrDiffContextWriterPort {
  async write(outputDir: string, context: PrDiffContext): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const path = resolve(join(outputDir, PR_DIFF_CONTEXT_FILE));
    const tmpPath = `${path}.tmp`;
    const payload = JSON.stringify(context, null, 2);
    let committed = false;

    try {
      await writeFile(tmpPath, payload, 'utf8');
      await rename(tmpPath, path);
      committed = true;
      return path;
    } finally {
      if (!committed) {
        await rm(tmpPath, { force: true }).catch(() => undefined);
      }
    }
  }
}
