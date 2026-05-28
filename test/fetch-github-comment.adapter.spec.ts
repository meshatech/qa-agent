import { describe, expect, it, vi } from 'vitest';
import { FetchGitHubCommentAdapter } from '../src/infra/github/fetch-github-comment.adapter.js';
import { GitHubCommentError } from '../src/domain/errors.js';

describe('FetchGitHubCommentAdapter', () => {
  const adapter = new FetchGitHubCommentAdapter();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createFetchMock(responses: Array<() => Promise<Response>>) {
    let callIndex = 0;
    return vi.fn(() => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response();
    });
  }

  it('posts comment when no existing marker is found', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 42,
      body: 'Test comment',
      token: 'ghp_fake_token',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const getCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const postCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(getCall[0]).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
    expect(postCall[0]).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
    expect(postCall[1].method).toBe('POST');
    const body = JSON.parse(postCall[1].body as string) as { body: string };
    expect(body.body).toContain('Test comment');
    expect(body.body).toContain('<!-- agent-qa-report -->');
  });

  it('skips posting when existing marker is found', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ body: 'Previous report\n<!-- agent-qa-report -->' }]),
      } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 42,
      body: 'New report',
      token: 'ghp_fake_token',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const getCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(getCall[0]).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
    expect(getCall[1].method).toBeUndefined();
  });

  it('sends correct headers on POST', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: 'body',
      token: 'ghp_test',
    });

    const postCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const headers = postCall[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 500 } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: 'body',
      token: 'ghp_test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 429 } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: 'body',
      token: 'ghp_test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on network failure and succeeds on second attempt', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.reject(new Error('Network error')),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: 'body',
      token: 'ghp_test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 401', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 401 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return error.statusCode === 401 && !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 403', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 403 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return error.statusCode === 403 && !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 404', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 404 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return error.statusCode === 404 && !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 422', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 422 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return error.statusCode === 422 && !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent 500', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: false, status: 500 } as Response),
      () => Promise.resolve({ ok: false, status: 502 } as Response),
      () => Promise.resolve({ ok: false, status: 503 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('truncates body when exceeding max length', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const largeBody = 'A'.repeat(65_000);
    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: largeBody,
      token: 'ghp_test',
    });

    const postCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const posted = JSON.parse(postCall[1].body as string) as { body: string };
    expect(posted.body.length).toBeLessThanOrEqual(60_000);
    expect(posted.body).toContain('<!-- agent-qa-report -->');
    expect(posted.body).toContain('This report was truncated');
    expect(posted.body).toContain('pr-report.md');
  });

  it('does not truncate body when under max length', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const smallBody = 'Short report content';
    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: smallBody,
      token: 'ghp_test',
    });

    const postCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const posted = JSON.parse(postCall[1].body as string) as { body: string };
    expect(posted.body).toContain('Short report content');
    expect(posted.body).toContain('<!-- agent-qa-report -->');
    expect(posted.body).not.toContain('This report was truncated');
  });

  it('preserves marker when truncating body that already contains marker', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.resolve({ ok: true, status: 201 } as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const largeBody = 'A'.repeat(65_000) + '\n<!-- agent-qa-report -->\n';
    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: largeBody,
      token: 'ghp_test',
    });

    const postCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const posted = JSON.parse(postCall[1].body as string) as { body: string };
    expect(posted.body.length).toBeLessThanOrEqual(60_000);
    expect(posted.body).toContain('<!-- agent-qa-report -->');
    expect(posted.body).toContain('This report was truncated');
    expect((posted.body.match(/<!-- agent-qa-report -->/g) ?? []).length).toBe(1);
  });

  it('does not leak token after retries', async () => {
    const fetchMock = createFetchMock([
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response),
      () => Promise.reject(new Error('ghp_secret_123 network failure')),
      () => Promise.reject(new Error('ghp_secret_123 still failing')),
      () => Promise.reject(new Error('ghp_secret_123 final failure')),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.postComment({
        repository: 'owner/repo',
        pullNumber: 1,
        body: 'body',
        token: 'ghp_secret_123',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof GitHubCommentError)) return false;
      return !error.message.includes('ghp_secret_123');
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
