import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { CorrelationResultSchema } from '../../domain/schemas/correlation.schema.js';
import type { RequiredScenario } from '../../domain/schemas/correlation.schema.js';
import { ConfigError } from '../../domain/errors.js';

export async function readRequiredScenarios(filePath: string): Promise<RequiredScenario[]> {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to read required-scenarios.json at ${absolutePath}: ${message}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid JSON in required-scenarios.json at ${absolutePath}: ${message}`, error);
  }

  let validated;
  try {
    validated = CorrelationResultSchema.parse(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Schema validation failed for required-scenarios.json at ${absolutePath}: ${message}`, error);
  }

  return validated.scenarios;
}
