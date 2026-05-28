import { Injectable } from '@nestjs/common';
import { GitHubCommentError } from '../../domain/errors.js';
import type { GitHubCommentPort } from '../../application/ports/github-comment.port.js';

@Injectable()
export class FetchGitHubCommentAdapter implements GitHubCommentPort {
  async postComment(input: {
    repository: string;
    pullNumber: number;
    body: string;
    token: string;
  }): Promise<void> {
    const url = `https://api.github.com/repos/${input.repository}/issues/${input.pullNumber}/comments`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: input.body }),
      });

      if (!response.ok) {
        throw new GitHubCommentError(
          `GitHub API returned ${response.status}`,
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof GitHubCommentError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubCommentError(`GitHub API request failed: ${message}`);
    }
  }
}
