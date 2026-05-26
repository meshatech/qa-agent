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
  });

  it('maps a ClickUp task response to DemandContext', async () => {
    mockFetch(200, SAMPLE_TASK);
    const reader = new ClickUpHttpReaderAdapter();

    const result = await reader.readTask('PRJ-11364', 'pk_test_token');

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

  it.each([
    [401, 'ClickUp read access denied (401)'],
    [403, 'ClickUp read access denied (403)'],
    [404, 'ClickUp task not found (PRJ-404)'],
    [429, 'ClickUp rate limit exceeded (429)'],
  ] as const)('throws ClickUpReaderError on HTTP %i', async (status, message) => {
    mockFetch(status);
    const reader = new ClickUpHttpReaderAdapter();

    await expect(reader.readTask('PRJ-404', 'pk_test_token')).rejects.toMatchObject({
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

    await expect(reader.readTask('PRJ-11364', 'pk_test_token')).rejects.toBeInstanceOf(
      ClickUpReaderError,
    );
  });
});
