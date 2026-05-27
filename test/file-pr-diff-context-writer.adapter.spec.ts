import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { PrDiffContextSchema } from '../src/domain/schemas/pr-diff-context.schema.js';
import { FilePrDiffContextWriterAdapter } from '../src/infra/persistence/file-pr-diff-context-writer.adapter.js';

const VALID_PR_DIFF_CONTEXT = {
  schemaVersion: 'pr-diff-context.v1' as const,
  pullRequest: {
    prNumber: 42,
    baseBranch: 'main',
    headBranch: 'feature/test',
    title: 'PRJ-11552 — Fix login flow',
    author: 'octocat',
    clickUpTaskId: 'PRJ-11552',
  },
  changedFiles: [],
  affectedRoutes: [],
  affectedSchemas: [],
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('FilePrDiffContextWriterAdapter', () => {
  it('writes pr-diff-context.json and returns absolute path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FilePrDiffContextWriterAdapter();

    const path = await adapter.write(dir, VALID_PR_DIFF_CONTEXT);
    const raw = await readFile(path, 'utf8');

    expect(path.endsWith('pr-diff-context.json')).toBe(true);
    expect(PrDiffContextSchema.parse(JSON.parse(raw))).toEqual(VALID_PR_DIFF_CONTEXT);
  });

  it('writes atomically without leaving a .tmp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FilePrDiffContextWriterAdapter();

    const path = await adapter.write(dir, VALID_PR_DIFF_CONTEXT);

    await expect(access(`${path}.tmp`)).rejects.toThrow();
    expect(PrDiffContextSchema.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(
      VALID_PR_DIFF_CONTEXT,
    );
  });

  it('removes .tmp file when rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-pr-diff-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FilePrDiffContextWriterAdapter();
    const finalPath = resolve(join(dir, 'pr-diff-context.json'));
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(finalPath);

    await expect(adapter.write(dir, VALID_PR_DIFF_CONTEXT)).rejects.toThrow();
    await expect(access(tmpPath)).rejects.toThrow();
  });
});
