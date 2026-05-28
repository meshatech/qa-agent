import { Injectable } from '@nestjs/common';
import { GitHubCommentError } from '../../domain/errors.js';
import type { GitHubCommentPort } from '../../application/ports/github-comment.port.js';

const AGENT_QA_COMMENT_MARKER = '<!-- agent-qa-report -->';
const MAX_GITHUB_COMMENT_BODY_LENGTH = 60_000;
const MAX_POST_COMMENT_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Authorization:\s*Bearer\s+\S+/g, 'Authorization: Bearer [REDACTED]')
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')
    .replace(/GITHUB_TOKEN=\S+/g, 'GITHUB_TOKEN=[REDACTED]')
    .replace(/CLICKUP_TOKEN=\S+/g, 'CLICKUP_TOKEN=[REDACTED]')
    .replace(/ghp_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghs_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/gho_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghu_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghr_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/pk_[a-zA-Z0-9_]+/g, '[REDACTED]');
}

@Injectable()
export class FetchGitHubCommentAdapter implements GitHubCommentPort {
  async postComment(input: {
    repository: string;
    pullNumber: number;
    body: string;
    token: string;
  }): Promise<void> {
    const existingCommentId = await this.findExistingAgentCommentId(input);
    const preparedBody = this.prepareCommentBody(input.body);

    if (existingCommentId !== undefined) {
      const url = `https://api.github.com/repos/${input.repository}/issues/comments/${existingCommentId}`;
      await this.doRequestWithRetry('PATCH', url, preparedBody, input.token);
      return;
    }

    const url = `https://api.github.com/repos/${input.repository}/issues/${input.pullNumber}/comments`;
    await this.doRequestWithRetry('POST', url, preparedBody, input.token);
  }

  private async doRequestWithRetry(method: 'POST' | 'PATCH', url: string, body: string, token: string): Promise<void> {
    let lastError: GitHubCommentError | undefined;

    for (let attempt = 0; attempt < MAX_POST_COMMENT_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ body }),
        });

        if (response.ok) {
          return;
        }

        const status = response.status;
        const errorMessage = sanitizeErrorMessage(`GitHub API returned ${status}`);
        lastError = new GitHubCommentError(errorMessage, status);

        if (!isRetryableError(status)) {
          throw lastError;
        }
      } catch (error) {
        if (error instanceof GitHubCommentError) {
          if (!isRetryableError(error.statusCode)) {
            throw error;
          }
          lastError = error;
        } else {
          const message = error instanceof Error ? error.message : String(error);
          const sanitized = sanitizeErrorMessage(`GitHub API request failed: ${message}`);
          lastError = new GitHubCommentError(sanitized);
        }
      }

      if (attempt < MAX_POST_COMMENT_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
      }
    }

    throw lastError ?? new GitHubCommentError('GitHub comment publication failed after retries');
  }

  private prepareCommentBody(body: string): string {
    const footer = '\n\n---\n_This report was truncated. Full report available in `pr-report.md`._';
    const marker = `\n${AGENT_QA_COMMENT_MARKER}\n`;
    const overhead = marker.length + footer.length;

    if (body.length + marker.length <= MAX_GITHUB_COMMENT_BODY_LENGTH) {
      return body.includes(AGENT_QA_COMMENT_MARKER) ? body : `${body}${marker}`;
    }

    const stripped = body.replace(new RegExp(AGENT_QA_COMMENT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trimEnd();
    const maxContentLength = MAX_GITHUB_COMMENT_BODY_LENGTH - overhead;
    const truncated = stripped.slice(0, Math.max(0, maxContentLength));
    return `${truncated}${marker}${footer}`;
  }

  private async findExistingAgentCommentId(input: {
    repository: string;
    pullNumber: number;
    token: string;
  }): Promise<number | undefined> {
    try {
      const url = `https://api.github.com/repos/${input.repository}/issues/${input.pullNumber}/comments`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        return undefined;
      }

      const comments = await response.json() as Array<{ id?: number; body?: string }>;
      const existing = comments.find((c) => c.body?.includes(AGENT_QA_COMMENT_MARKER));
      return existing?.id;
    } catch {
      return undefined;
    }
  }
}
