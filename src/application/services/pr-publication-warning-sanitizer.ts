import { GitHubCommentError } from '../../domain/errors.js';
import { redactTokenPatterns } from '../helpers/sanitize-token.js';

export function sanitizePublicationWarning(message: string): string {
  return redactTokenPatterns(message);
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
