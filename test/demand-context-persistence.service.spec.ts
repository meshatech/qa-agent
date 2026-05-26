import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ClickUpReaderPort } from '../src/application/ports/clickup-reader.port.js';
import { DemandContextPersistenceService } from '../src/application/services/demand-context-persistence.service.js';
import { SanitizerService } from '../src/application/services/sanitizer.service.js';
import { ClickUpReaderError } from '../src/domain/errors.js';
import { DemandContextSchema } from '../src/domain/schemas/demand-context.schema.js';
import { FileDemandContextWriterAdapter } from '../src/infra/persistence/file-demand-context-writer.adapter.js';
import { sanitizeClickUpErrorMessage } from '../src/infra/clickup/clickup-http-error.handler.js';

const VALID_DEMAND_CONTEXT = {
  taskId: 'PRJ-11373',
  title: 'Gerar demand-context.json',
  description: 'Persistir DemandContext no diretório de execução.',
  acceptanceCriteria: ['demand-context.json é gerado'],
  attachments: [
    {
      name: 'spec.pdf',
      url: 'https://example.com/spec.pdf',
      type: 'application/pdf',
    },
  ],
  status: 'fazendo',
  assignees: ['Joao de tal da silva'],
  priority: 'normal',
  dueDate: '2026-05-26T00:00:00.000Z',
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('DemandContextPersistenceService', () => {
  it('persistDemandContext writes sanitized demand via writer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-persist-'));
    tempDirs.push(dir);
    const writer = new FileDemandContextWriterAdapter();
    const writeSpy = vi.spyOn(writer, 'write');
    const service = new DemandContextPersistenceService(
      writer,
      { readTask: vi.fn(), readConfiguredTask: vi.fn() },
      new SanitizerService(),
    );

    const { path, demand } = await service.persistDemandContext(dir, VALID_DEMAND_CONTEXT);

    expect(writeSpy).toHaveBeenCalledWith(dir, VALID_DEMAND_CONTEXT);
    expect(path.endsWith('demand-context.json')).toBe(true);
    expect(demand).toEqual(VALID_DEMAND_CONTEXT);
    expect(DemandContextSchema.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(
      VALID_DEMAND_CONTEXT,
    );
  });

  it('does not write known secrets into demand-context.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-persist-'));
    tempDirs.push(dir);
    const secret = 'pk_secret_token_12345678';
    const service = new DemandContextPersistenceService(
      new FileDemandContextWriterAdapter(),
      { readTask: vi.fn(), readConfiguredTask: vi.fn() },
      new SanitizerService(),
    );

    const { path, demand } = await service.persistDemandContext(
      dir,
      {
        ...VALID_DEMAND_CONTEXT,
        description: `Use token ${secret} in header`,
      },
      [secret],
    );
    const raw = await readFile(path, 'utf8');

    expect(raw).not.toContain(secret);
    expect(raw).toContain('***REDACTED***');
    expect(demand.description).not.toContain(secret);
    expect(demand.description).toContain('***REDACTED***');
  });

  it('persistFromClickUpTask reads ClickUp demand and writes demand-context.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-persist-'));
    tempDirs.push(dir);
    const clickUpReader: ClickUpReaderPort = {
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => ({ demand: VALID_DEMAND_CONTEXT })),
    };
    const service = new DemandContextPersistenceService(
      new FileDemandContextWriterAdapter(),
      clickUpReader,
      new SanitizerService(),
    );

    const result = await service.persistFromClickUpTask(dir, 'pk_test_token', {
      configTaskId: 'PRJ-11373',
      configTeamId: '459806',
    });

    expect(clickUpReader.readConfiguredTask).toHaveBeenCalledWith(
      'pk_test_token',
      'PRJ-11373',
      '459806',
    );
    expect(result.path.endsWith('demand-context.json')).toBe(true);
    expect(result.demand).toEqual(VALID_DEMAND_CONTEXT);
    expect(DemandContextSchema.parse(JSON.parse(await readFile(result.path, 'utf8')))).toEqual(
      VALID_DEMAND_CONTEXT,
    );
  });

  it.each([
    ['AUTH_FAILED', 'ClickUp authentication failed (401)', 401],
    ['TASK_NOT_FOUND', 'ClickUp task not found (PRJ-11373)', 404],
    ['REQUEST_FAILED', 'ClickUp API request failed: network down', undefined],
  ] as const)(
    'persistFromClickUpTask propagates ClickUpReaderError with code %s',
    async (code, message, statusCode) => {
      const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-persist-'));
      tempDirs.push(dir);
      const token = 'pk_test_token_abcdef12';
      const readerError = new ClickUpReaderError(message, statusCode, undefined, code);
      const clickUpReader: ClickUpReaderPort = {
        readTask: vi.fn(),
        readConfiguredTask: vi.fn(async () => {
          throw readerError;
        }),
      };
      const service = new DemandContextPersistenceService(
        new FileDemandContextWriterAdapter(),
        clickUpReader,
        new SanitizerService(),
      );

      await expect(
        service.persistFromClickUpTask(dir, token, {
          configTaskId: 'PRJ-11373',
          configTeamId: '459806',
        }),
      ).rejects.toBe(readerError);

      await expect(access(join(dir, 'demand-context.json'))).rejects.toThrow();
    },
  );

  it('persistFromClickUpTask propagates sanitized ClickUpReaderError without leaking token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-qa-demand-context-persist-'));
    tempDirs.push(dir);
    const token = 'pk_leaked_token_12345678';
    const readerError = new ClickUpReaderError(
      sanitizeClickUpErrorMessage(
        `ClickUp API request failed: Authorization ${token} failed`,
        token,
      ),
      undefined,
      undefined,
      'REQUEST_FAILED',
    );
    const clickUpReader: ClickUpReaderPort = {
      readTask: vi.fn(),
      readConfiguredTask: vi.fn(async () => {
        throw readerError;
      }),
    };
    const service = new DemandContextPersistenceService(
      new FileDemandContextWriterAdapter(),
      clickUpReader,
      new SanitizerService(),
    );

    await expect(
      service.persistFromClickUpTask(dir, token, {
        configTaskId: 'PRJ-11373',
        configTeamId: '459806',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBe(readerError);
      expect(error).toBeInstanceOf(ClickUpReaderError);
      const propagated = error as ClickUpReaderError;
      expect(propagated.code).toBe('REQUEST_FAILED');
      expect(propagated.message).not.toContain(token);
      expect(propagated.message).toContain('***REDACTED***');
      return true;
    });

    await expect(access(join(dir, 'demand-context.json'))).rejects.toThrow();
  });
});
