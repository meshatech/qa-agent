import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readPipelineArtifact } from '../src/application/helpers/read-pipeline-artifact.js';
import { ConfigError } from '../src/domain/errors.js';
import { PrDiffContextSchema } from '../src/domain/schemas/pr-diff-context.schema.js';

const FIXTURES_DIR = join(process.cwd(), 'test/fixtures/pipeline');
const ARTIFACT_FILENAME = 'pr-diff-context.json';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('readPipelineArtifact', () => {
  it('returns parsed data when the artifact is valid', async () => {
    const outputDir = await createOutputDir();
    const expected = JSON.parse(await readFile(join(FIXTURES_DIR, ARTIFACT_FILENAME), 'utf8'));
    await writeFile(join(outputDir, ARTIFACT_FILENAME), JSON.stringify(expected, null, 2), 'utf8');

    const result = await readPipelineArtifact(outputDir, ARTIFACT_FILENAME, PrDiffContextSchema);

    expect(result).toEqual(expected);
  });

  it('throws ConfigError when the artifact file is missing', async () => {
    const outputDir = await createOutputDir();

    await expect(
      readPipelineArtifact(outputDir, ARTIFACT_FILENAME, PrDiffContextSchema),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes('Pipeline artifact not found'),
    );
  });

  it('throws ConfigError when the artifact contains invalid JSON', async () => {
    const outputDir = await createOutputDir();
    await writeFile(join(outputDir, ARTIFACT_FILENAME), '{ broken', 'utf8');

    await expect(
      readPipelineArtifact(outputDir, ARTIFACT_FILENAME, PrDiffContextSchema),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes('Pipeline artifact invalid JSON'),
    );
  });

  it('throws ConfigError when the artifact fails schema validation', async () => {
    const outputDir = await createOutputDir();
    await writeFile(join(outputDir, ARTIFACT_FILENAME), JSON.stringify({}), 'utf8');

    await expect(
      readPipelineArtifact(outputDir, ARTIFACT_FILENAME, PrDiffContextSchema),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes('Pipeline artifact validation failed'),
    );
  });
});

async function createOutputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-qa-read-pipeline-artifact-'));
  tempDirs.push(dir);
  return dir;
}
