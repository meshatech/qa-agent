import { describe, expect, it, vi } from 'vitest';
import { FetchGitHubCommentAdapter } from '../src/infra/github/fetch-github-comment.adapter.js';
import { GitHubCommentError } from '../src/domain/errors.js';

describe('FetchGitHubCommentAdapter', () => {
  const adapter = new FetchGitHubCommentAdapter();

  it('posts comment to the correct endpoint', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 201 } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 42,
      body: 'Test comment',
      token: 'ghp_fake_token',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body as string)).toEqual({ body: 'Test comment' });

    vi.unstubAllGlobals();
  });

  it('sends correct headers', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 201 } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await adapter.postComment({
      repository: 'owner/repo',
      pullNumber: 1,
      body: 'body',
      token: 'ghp_test',
    });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');

    vi.unstubAllGlobals();
  });

  it('throws GitHubCommentError on HTTP error without leaking token', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 403 } as Response),
    );
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

    vi.unstubAllGlobals();
  });

  it('throws GitHubCommentError on network failure without leaking token', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
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

    vi.unstubAllGlobals();
  });
});
