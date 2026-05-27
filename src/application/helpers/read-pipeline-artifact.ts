import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { z } from 'zod';

import { ConfigError } from '../../domain/errors.js';

export async function readPipelineArtifact<T>(
  outputDir: string,
  filename: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const path = resolve(join(outputDir, filename));
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ConfigError(`Pipeline artifact not found: ${filename}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`Pipeline artifact invalid JSON: ${filename}`, cause);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Pipeline artifact validation failed: ${filename}`, result.error);
  }

  return result.data;
}
