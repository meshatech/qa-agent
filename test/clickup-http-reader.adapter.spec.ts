import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('readConfiguredTask resolves taskId from env and calls ClickUp API with custom ID params', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_TASK,
      }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('CLICKUP_TASK_ID', 'PRJ-11366');
    vi.stubEnv('CLICKUP_TEAM_ID', '459806');
    const reader = new ClickUpHttpReaderAdapter();

    await reader.readConfiguredTask('pk_test_token');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/PRJ-11366?custom_task_ids=true&team_id=459806',
      { headers: { Authorization: 'pk_test_token' } },
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
      { headers: { Authorization: 'pk_test_token' } },
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

    expect(fetchMock).toHaveBeenCalledWith('https://api.clickup.com/api/v2/task/86ahmgh5e', {
      headers: { Authorization: 'pk_test_token' },
    });
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
      { headers: { Authorization: 'pk_test_token' } },
    );
    expect(fetchMock.mock.calls.some(([calledUrl]) => calledUrl === 'https://example.com/spec.pdf')).toBe(
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

  it.each([
    [401, 'ClickUp read access denied (401)'],
    [403, 'ClickUp read access denied (403)'],
    [404, 'ClickUp task not found (PRJ-404)'],
    [429, 'ClickUp rate limit exceeded (429)'],
  ] as const)('throws ClickUpReaderError on HTTP %i', async (status, message) => {
    mockFetch(status);
    const reader = new ClickUpHttpReaderAdapter();

    await expect(
      reader.readTask('PRJ-404', 'pk_test_token', { configTeamId: '459806' }),
    ).rejects.toMatchObject({
      name: 'ClickUpReaderError',
      message,
      statusCode: status,
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
