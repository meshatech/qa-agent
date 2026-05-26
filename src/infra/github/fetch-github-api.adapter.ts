import { Injectable } from '@nestjs/common';

import type { GitHubApiPort, GitHubPrCommentPermissionResult } from '../../application/ports/github-api.port.js';

@Injectable()
export class FetchGitHubApiAdapter implements GitHubApiPort {
  async verifyPrCommentPermission(params: {
    token: string;
    repository: string;
    pullNumber: number;
  }): Promise<GitHubPrCommentPermissionResult> {
    const url = `https://api.github.com/repos/${params.repository}/pulls/${params.pullNumber}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${params.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          statusCode: response.status,
          warning: `GitHub PR comment permission denied (${response.status})`,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          warning: `GitHub API error (${response.status})`,
        };
      }

      return { ok: true, statusCode: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, warning: `GitHub API request failed: ${message}` };
    }
  }
}
