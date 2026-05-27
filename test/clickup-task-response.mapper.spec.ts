import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import * as bugResultsParser from '../src/infra/clickup/clickup-bug-results.parser.js';
import * as reproductionStepsParser from '../src/infra/clickup/clickup-reproduction-steps.parser.js';
import { ClickUpReaderError } from '../src/domain/errors.js';
import { BugContextSchema } from '../src/domain/schemas/bug-context.schema.js';
import { mapClickUpTaskToReadResult } from '../src/infra/clickup/clickup-task-response.mapper.js';

describe('mapClickUpTaskToReadResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters empty reproduction steps and omits bug when no bug data remains', () => {
    vi.spyOn(reproductionStepsParser, 'extractClickUpReproductionSteps').mockReturnValue(['']);
    vi.spyOn(bugResultsParser, 'extractClickUpBugResults').mockReturnValue({
      expectedResult: null,
      actualResult: null,
    });

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11369',
      name: 'Optional bug context',
      description: 'Task body',
      status: { status: 'fazendo' },
    });

    expect(result.demand.taskId).toBe('PRJ-11369');
    expect(result.bug).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('normalizes empty bug result strings to null and keeps valid reproduction steps', () => {
    vi.spyOn(reproductionStepsParser, 'extractClickUpReproductionSteps').mockReturnValue([
      ' Abrir login ',
      '',
    ]);
    vi.spyOn(bugResultsParser, 'extractClickUpBugResults').mockReturnValue({
      expectedResult: '   ',
      actualResult: 'Tela em branco',
    });

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11370',
      name: 'Bug context normalization',
      description: 'Task body',
      status: { status: 'fazendo' },
    });

    expect(result.bug).toEqual({
      reproductionSteps: ['Abrir login'],
      expectedResult: null,
      actualResult: 'Tela em branco',
    });
  });

  it('returns ISO 8601 due dates unchanged', () => {
    const isoDueDate = '2026-05-26T12:00:00.000Z';

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11366',
      name: 'Due date ISO',
      description: 'Task body',
      due_date: isoDueDate,
    });

    expect(result.demand.dueDate).toBe(isoDueDate);
  });

  it('converts numeric epoch due dates to ISO strings', () => {
    const epochMs = Date.parse('2026-05-26T00:00:00.000Z');

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11366',
      name: 'Due date epoch',
      description: 'Task body',
      due_date: epochMs,
    });

    expect(result.demand.dueDate).toBe('2026-05-26T00:00:00.000Z');
  });

  it('returns null and warns for unsupported due date formats', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11366',
      name: 'Due date invalid',
      description: 'Task body',
      due_date: 'not-a-date',
    });

    expect(result.demand.dueDate).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('ClickUp due date ignored due to unsupported format');
  });

  it('omits bug and adds warning when BugContextSchema validation fails after normalization', () => {
    vi.spyOn(reproductionStepsParser, 'extractClickUpReproductionSteps').mockReturnValue(['Step 1']);
    vi.spyOn(bugResultsParser, 'extractClickUpBugResults').mockReturnValue({
      expectedResult: 'Expected',
      actualResult: 'Actual',
    });
    vi.spyOn(BugContextSchema, 'safeParse').mockReturnValue({
      success: false,
      error: new ZodError([]),
    } as ReturnType<typeof BugContextSchema.safeParse>);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = mapClickUpTaskToReadResult({
      id: '86ahmgh5e',
      custom_id: 'PRJ-11371',
      name: 'Bug context validation failure',
      description: 'Task body',
      status: { status: 'fazendo' },
    });

    expect(result.bug).toBeUndefined();
    expect(result.warnings).toContain('Bug context validation failed');
    expect(warnSpy).toHaveBeenCalledWith('ClickUp bug context ignored due to validation failure');
  });

  it('throws ClickUpReaderError without exposing raw demand validation input', () => {
    const secret = 'pk_leaked_token_12345678';

    expect(() =>
      mapClickUpTaskToReadResult({
        id: '86ahmgh5e',
        custom_id: 'PRJ-11367',
        name: '   ',
        description: `Bearer ${secret}`,
      }),
    ).toThrow(ClickUpReaderError);

    try {
      mapClickUpTaskToReadResult({
        id: '86ahmgh5e',
        custom_id: 'PRJ-11367',
        name: '   ',
        description: `Bearer ${secret}`,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ClickUpReaderError);
      const readerError = error as ClickUpReaderError;
      expect(readerError.code).toBe('API_ERROR');
      expect(readerError.message).toBe('ClickUp demand mapping failed');
      expect(readerError.message).not.toContain(secret);
      expect(readerError.cause).toBeInstanceOf(Error);
      expect((readerError.cause as Error).message).toBe('ClickUp demand mapping failed');
      expect((readerError.cause as Error).message).not.toContain(secret);
    }
  });
});
