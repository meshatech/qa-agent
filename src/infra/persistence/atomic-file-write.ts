import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { commitAtomicJsonWrite } from './atomic-json-write.js';

export async function writeAtomicFile(
  outputDir: string,
  filename: string,
  content: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const path = resolve(join(outputDir, filename));
  const tmpPath = `${path}.tmp`;
  let committed = false;

  try {
    await writeFile(tmpPath, content, 'utf8');
    await commitAtomicJsonWrite(tmpPath, path);
    committed = true;
    return path;
  } finally {
    if (!committed) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
}
