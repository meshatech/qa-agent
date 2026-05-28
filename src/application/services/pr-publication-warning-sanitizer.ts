import { GitHubCommentError } from '../../domain/errors.js';

export function sanitizePublicationWarning(message: string): string {
  return message
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')
    .replace(/GITHUB_TOKEN=\S+/g, 'GITHUB_TOKEN=[REDACTED]')
    .replace(/ghp_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghs_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/gho_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghu_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghr_[a-zA-Z0-9_]+/g, '[REDACTED]');
}

export function buildPublicationWarning(error: unknown): string {
  if (error instanceof GitHubCommentError && error.statusCode !== undefined) {
    switch (error.statusCode) {
      case 401:
        return 'Not published: invalid or unauthorized token';
      case 403:
        return 'Not published: token lacks permission';
      case 404:
        return 'Not published: repository or pull request not found';
      case 422:
        return 'Not published: invalid comment payload';
      case 429:
        return 'Not published: GitHub rate limit exceeded';
      default:
        if (error.statusCode >= 500 && error.statusCode <= 599) {
          return 'Not published: GitHub API temporary failure';
        }
    }
  }

  const text = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizePublicationWarning(text);

  if (error instanceof GitHubCommentError) {
    return `Not published: ${sanitized}`;
  }

  return `Not published: GitHub API request failed`;
}
