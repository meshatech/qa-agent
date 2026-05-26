import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { FileDemandContextWriterAdapter } from '../src/infra/persistence/file-demand-context-writer.adapter.js';

const VALID_DEMAND_CONTEXT = {
  taskId: 'PRJ-11361',
  title: 'Criar DemandContext',
  description:
    'Criar o contrato de domínio DemandContext para representar a demanda extraída de uma task do ClickUp.',
  acceptanceCriteria: ['DemandContext é definido no domínio'],
  attachments: [
    {
      name: 'spec.pdf',
      url: 'https://example.com/spec.pdf',
      type: 'application/pdf',
    },
  ],
  status: 'fazendo',
  assignees: ['Joao de tal da silva'],
  priority: null,
  dueDate: null,
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('FileDemandContextWriterAdapter', () => {
  it('writes demand-context.json and returns absolute path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FileDemandContextWriterAdapter();

    const path = await adapter.write(dir, VALID_DEMAND_CONTEXT);
    const raw = await readFile(path, 'utf8');

    expect(path.endsWith('demand-context.json')).toBe(true);
    expect(DemandContextSchema.parse(JSON.parse(raw))).toEqual(VALID_DEMAND_CONTEXT);
  });

  it('writes atomically without leaving a .tmp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FileDemandContextWriterAdapter();

    const path = await adapter.write(dir, VALID_DEMAND_CONTEXT);

    await expect(access(`${path}.tmp`)).rejects.toThrow();
    expect(DemandContextSchema.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(
      VALID_DEMAND_CONTEXT,
    );
  });

  it('removes .tmp file when rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-writer-'));
    tempDirs.push(dir);
    const adapter = new FileDemandContextWriterAdapter();
    const finalPath = resolve(join(dir, 'demand-context.json'));
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(finalPath);

    await expect(adapter.write(dir, VALID_DEMAND_CONTEXT)).rejects.toThrow();
    await expect(access(tmpPath)).rejects.toThrow();
  });
});
