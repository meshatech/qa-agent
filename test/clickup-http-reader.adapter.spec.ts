import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ClickUpReaderError } from '../src/domain/errors.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';

const SAMPLE_TASK = {
  id: '86ahmgh5e',
  custom_id: 'PRJ-11364',
  name: 'Criar ClickUpReaderPort',
  description: 'Criar a interface/porta ClickUpReaderPort.',
  status: { status: 'desenvolvido' },
  assignees: [{ username: 'Joao de tal da silva' }],
  priority: null,
  due_date: null,
  attachments: [
    {
      title: 'spec.pdf',
      url: 'https://example.com/spec.pdf',
      mimetype: 'application/pdf',
    },
  ],
};

function mockFetch(status: number, body?: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
    ),
  );
}

describe('ClickUpHttpReaderAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('readConfiguredTask resolves taskId from config and calls ClickUp API with custom ID params', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_TASK,
      }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    await reader.readConfiguredTask('pk_test_token', 'PRJ-11366', '459806');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/PRJ-11366?custom_task_ids=true&team_id=459806',
      expect.objectContaining({
        headers: { Authorization: 'pk_test_token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('calls ClickUp task API with custom task ID query params', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_TASK,
      }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    await reader.readTask('PRJ-11365', 'pk_test_token', { configTeamId: '459806' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/PRJ-11365?custom_task_ids=true&team_id=459806',
      expect.objectContaining({
        headers: { Authorization: 'pk_test_token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('calls ClickUp task API without custom ID params for internal task IDs', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_TASK,
      }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    await reader.readTask('86ahmgh5e', 'pk_test_token');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/86ahmgh5e',
      expect.objectContaining({
        headers: { Authorization: 'pk_test_token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('maps a ClickUp task response to DemandContext', async () => {
    mockFetch(200, SAMPLE_TASK);
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand).toEqual({
      taskId: 'PRJ-11364',
      title: 'Criar ClickUpReaderPort',
      description: 'Criar a interface/porta ClickUpReaderPort.',
      acceptanceCriteria: [],
      attachments: [
        {
          name: 'spec.pdf',
          url: 'https://example.com/spec.pdf',
          type: 'application/pdf',
        },
      ],
      status: 'desenvolvido',
      assignees: ['Joao de tal da silva'],
      priority: null,
      dueDate: null,
    });
  });

  it('sanitizes HTML markup from task description', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      description: '<p>HTML <strong>description</strong></p><br/>line two',
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand.description).toBe('HTML description\nline two');
    expect(result.demand.description).not.toMatch(/<[^>]+>/);
  });

  it('trims whitespace from task title', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      name: '  Ler título  ',
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand.title).toBe('Ler título');
  });

  it('extracts acceptance criteria from description section', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      description: `Task body
Critérios de Aceite
- [x] ClickUpReaderPort é definido.
- [x] Método readTask(taskId, token) retorna DemandContext.`,
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand.acceptanceCriteria).toEqual([
      'ClickUpReaderPort é definido.',
      'Método readTask(taskId, token) retorna DemandContext.',
    ]);
    expect(result.bug).toBeUndefined();
  });

  it('extracts reproduction steps into optional BugContext', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      description: `Bug report
Passos para Reproduzir
1. Abrir a tela de login
2. Clicar em Entrar`,
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.bug).toEqual({
      reproductionSteps: ['Abrir a tela de login', 'Clicar em Entrar'],
      expectedResult: null,
      actualResult: null,
    });
  });

  it('does not include bug context when reproduction section is absent', async () => {
    mockFetch(200, SAMPLE_TASK);
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.bug).toBeUndefined();
  });

  it('extracts expected and actual results into BugContext', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      description: `Bug report
Resultado Esperado
Mensagem de erro visível
Resultado Obtido
Tela em branco`,
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.bug).toEqual({
      reproductionSteps: [],
      expectedResult: 'Mensagem de erro visível',
      actualResult: 'Tela em branco',
    });
  });

  it('maps multiple attachments and skips deleted entries', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      attachments: [
        {
          title: 'spec.pdf',
          url: 'https://example.com/spec.pdf',
          mimetype: 'application/pdf',
        },
        {
          title: 'removed.png',
          url: 'https://example.com/removed.png',
          mimetype: 'image/png',
          deleted: true,
        },
        {
          url: 'https://example.com/logs.txt',
          extension: 'txt',
        },
      ],
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand.attachments).toEqual([
      {
        name: 'spec.pdf',
        url: 'https://example.com/spec.pdf',
        type: 'application/pdf',
      },
      {
        name: 'logs.txt',
        url: 'https://example.com/logs.txt',
        type: 'text/plain',
      },
    ]);
  });

  it('returns empty attachments when task has none', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      attachments: [],
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.demand.attachments).toEqual([]);
  });

  it('does not download attachment content (single task GET only)', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ...SAMPLE_TASK,
          attachments: [
            {
              title: 'spec.pdf',
              url: 'https://example.com/spec.pdf',
              mimetype: 'application/pdf',
            },
          ],
        }),
      }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    await reader.readTask('PRJ-11364', 'pk_test_token', { configTeamId: '459806' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/PRJ-11364?custom_task_ids=true&team_id=459806',
      expect.objectContaining({
        headers: { Authorization: 'pk_test_token' },
        signal: expect.any(AbortSignal),
      }),
    );
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(fetchCalls.some(([calledUrl]) => calledUrl === 'https://example.com/spec.pdf')).toBe(
      false,
    );
  });

  it('includes bug context with results and reproduction steps together', async () => {
    mockFetch(200, {
      ...SAMPLE_TASK,
      description: `Bug report
Passos para Reproduzir
1. Abrir login
Resultado Esperado
Erro visível
Resultado Obtido
Tela em branco`,
    });
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });

    expect(result.bug).toEqual({
      reproductionSteps: ['Abrir login'],
      expectedResult: 'Erro visível',
      actualResult: 'Tela em branco',
    });
  });

  it('throws API_ERROR when ClickUp task payload is invalid', async () => {
    mockFetch(200, { id: '86ahmgh5e' });
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-11364', 'pk_test_token', { configTeamId: '459806' }),
    ).rejects.toMatchObject({
      name: 'ClickUpReaderError',
      code: 'API_ERROR',
      message: 'ClickUp API returned an invalid task payload',
    });
  });

  it('does not expose raw ZodError as cause for invalid payload', async () => {
    mockFetch(200, { id: '86ahmgh5e', name: 123 });
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-11364', 'pk_test_token', { configTeamId: '459806' }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ClickUpReaderError);
      const readerError = error as ClickUpReaderError;
      expect(readerError.cause).toBeInstanceOf(Error);
      expect(readerError.cause).not.toBeInstanceOf(ZodError);
      expect((readerError.cause as Error).message).toBe(
        'ClickUp API returned an invalid task payload',
      );
      return true;
    });
  });

  it('throws API_ERROR with HTTP status when ClickUp response JSON is malformed', async () => {
    const leakedToken = 'pk_leaked_malformed_json_token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError(`Unexpected token in JSON at position 0: Bearer ${leakedToken}`);
          },
        }) as unknown as Response,
      ),
    );
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-11364', leakedToken, { configTeamId: '459806' }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ClickUpReaderError);
      const readerError = error as ClickUpReaderError;
      expect(readerError.code).toBe('API_ERROR');
      expect(readerError.statusCode).toBe(200);
      expect(readerError.message).toContain('malformed JSON');
      expect(readerError.message).not.toContain(leakedToken);
      expect(readerError.cause).toBeInstanceOf(Error);
      expect((readerError.cause as Error).message).not.toContain(leakedToken);
      return true;
    });
  });

  it.each([
    [401, 'AUTH_FAILED', 'ClickUp authentication failed (401)'],
    [403, 'PERMISSION_DENIED', 'ClickUp permission denied (403)'],
    [404, 'TASK_NOT_FOUND', 'ClickUp task not found (PRJ-404)'],
  ] as const)(
    'throws ClickUpReaderError with code on HTTP %i',
    async (status, code, message) => {
      mockFetch(status);
      const reader = new ClickUpHttpReaderAdapter();

      await expect(
        reader.readTask('PRJ-404', 'pk_test_token', { configTeamId: '459806' }),
      ).rejects.toMatchObject({
        name: 'ClickUpReaderError',
        message,
        statusCode: status,
        code,
      });
    },
  );

  it('retries on 429 and succeeds after backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => SAMPLE_TASK,
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    const resultPromise = reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    expect(result.demand.taskId).toBe('PRJ-11364');
    vi.useRealTimers();
  });

  it('throws RATE_LIMIT_EXCEEDED after exhausting 429 retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '0' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    const resultPromise = reader.readTask('PRJ-404', 'pk_test_token', {
      configTeamId: '459806',
    });
    const assertion = expect(resultPromise).rejects.toMatchObject({
      name: 'ClickUpReaderError',
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      message: 'ClickUp rate limit exceeded (429)',
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('throws REQUEST_FAILED when ClickUp API request times out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ClickUpHttpReaderAdapter();

    const resultPromise = reader.readTask('PRJ-11364', 'pk_test_token', {
      configTeamId: '459806',
    });
    const assertion = expect(resultPromise).rejects.toMatchObject({
      name: 'ClickUpReaderError',
      code: 'REQUEST_FAILED',
      message: 'ClickUp API request timed out',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    vi.useRealTimers();
  });

  it('does not expose token in network failure messages', async () => {
    const leakedToken = 'pk_leaked_token_12345678';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`Authorization ${leakedToken} failed`);
      }),
    );
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-11364', leakedToken, { configTeamId: '459806' }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ClickUpReaderError);
      const readerError = error as ClickUpReaderError;
      expect(readerError.code).toBe('REQUEST_FAILED');
      expect(readerError.message).not.toContain(leakedToken);
      expect(readerError.message).toContain('***REDACTED***');
      expect(readerError.cause).toBeInstanceOf(Error);
      expect((readerError.cause as Error).message).not.toContain(leakedToken);
      expect((readerError.cause as Error).message).toContain('***REDACTED***');
      return true;
    });
  });

  it('wraps network failures as ClickUpReaderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-11364', 'pk_test_token', { configTeamId: '459806' }),
    ).rejects.toBeInstanceOf(ClickUpReaderError);
  });
});
