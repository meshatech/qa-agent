import { Inject, Injectable } from '@nestjs/common';
import type { GitHubCommentPort } from '../ports/github-comment.port.js';
import type { GitHubEventContextPort } from '../ports/github-event-context.port.js';

@Injectable()
export class PipelineBlockedNotifier {
  constructor(
    @Inject('GitHubCommentPort') private readonly githubComment: GitHubCommentPort,
    @Inject('GitHubEventContextPort') private readonly githubEventContext: GitHubEventContextPort,
  ) {}

  async notify(body: string): Promise<boolean> {
    const repository = process.env.GITHUB_REPOSITORY?.trim() ?? '';
    const pullNumber = await this.githubEventContext.resolvePullNumber();
    const token = this.resolveGitHubToken();

    if (!repository || !pullNumber || !token) {
      return false;
    }

    try {
      await this.githubComment.postComment({
        repository,
        pullNumber,
        body,
        token,
      });
      return true;
    } catch {
      return false;
    }
  }

  private resolveGitHubToken(): string | undefined {
    const token =
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      process.env.INPUT_GITHUB_TOKEN?.trim();
    return token && token.length > 0 ? token : undefined;
  }
}
