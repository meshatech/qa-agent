import { describe, expect, it } from 'vitest';
import { sanitizePublicationWarning, buildPublicationWarning } from '../src/application/services/pr-publication-warning-sanitizer.js';
import { GitHubCommentError } from '../src/domain/errors.js';

describe('sanitizePublicationWarning', () => {
  it('masks Bearer token', () => {
    const result = sanitizePublicationWarning('Error with Bearer ghp_secret_123');
    expect(result).toBe('Error with Bearer [REDACTED]');
  });

  it('masks ghp_ token', () => {
    const result = sanitizePublicationWarning('ghp_abc123 failed');
    expect(result).toBe('[REDACTED] failed');
  });

  it('masks github_pat_ token', () => {
    const result = sanitizePublicationWarning('github_pat_abc123_xyz');
    expect(result).toBe('[REDACTED]');
  });

  it('masks ghs_ token', () => {
    const result = sanitizePublicationWarning('ghs_installation_token');
    expect(result).toBe('[REDACTED]');
  });

  it('keeps common message without token', () => {
    const message = 'Not published: token lacks permission';
    expect(sanitizePublicationWarning(message)).toBe(message);
  });

  it('masks GITHUB_TOKEN= value', () => {
    const result = sanitizePublicationWarning('Env GITHUB_TOKEN=ghp_secret_123 set');
    expect(result).toBe('Env GITHUB_TOKEN=[REDACTED] set');
  });

  it('masks multiple tokens in one message', () => {
    const result = sanitizePublicationWarning('Bearer ghp_123 and github_pat_456');
    expect(result).toBe('Bearer [REDACTED] and [REDACTED]');
  });
});

describe('buildPublicationWarning', () => {
  it('maps 401 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Unauthorized', 401));
    expect(result).toBe('Not published: invalid or unauthorized token');
  });

  it('maps 403 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Forbidden', 403));
    expect(result).toBe('Not published: token lacks permission');
  });

  it('maps 404 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Not Found', 404));
    expect(result).toBe('Not published: repository or pull request not found');
  });

  it('maps 422 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Unprocessable', 422));
    expect(result).toBe('Not published: invalid comment payload');
  });

  it('maps 429 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Too Many', 429));
    expect(result).toBe('Not published: GitHub rate limit exceeded');
  });

  it('maps 500 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Server Error', 500));
    expect(result).toBe('Not published: GitHub API temporary failure');
  });

  it('maps 503 to specific message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Unavailable', 503));
    expect(result).toBe('Not published: GitHub API temporary failure');
  });

  it('maps generic GitHubCommentError to sanitized message', () => {
    const result = buildPublicationWarning(new GitHubCommentError('Some error', 418));
    expect(result).toBe('Not published: Some error');
  });

  it('maps network error to generic message', () => {
    const result = buildPublicationWarning(new Error('Network timeout'));
    expect(result).toBe('Not published: GitHub API request failed');
  });

  it('masks token in generic error message', () => {
    const result = buildPublicationWarning(new Error('ghp_secret_123 failed'));
    expect(result).toBe('Not published: GitHub API request failed');
    expect(result).not.toContain('ghp_secret_123');
  });
});
