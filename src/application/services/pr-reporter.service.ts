import { Inject, Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { GitHubCommentPort } from '../ports/github-comment.port.js';
import { PRReportRenderer } from './pr-report-renderer.service.js';

export interface PRReportResult {
  reportPath: string;
  published: boolean;
  publicationWarning?: string;
}

@Injectable()
export class PRReporterService {
  constructor(
    @Inject('GitHubCommentPort') private readonly githubComment: GitHubCommentPort,
    @Inject('RunRepositoryPort') private readonly runRepository: RunRepositoryPort,
    private readonly renderer: PRReportRenderer,
  ) {}

  async report(input: {
    result: QaRunResult;
    config: RunConfig;
    runDir: string;
    repository: string;
    pullNumber: number;
    token?: string;
    commitSha?: string;
    headRef?: string;
    baseRef?: string;
  }): Promise<PRReportResult> {
    const markdown = this.renderer.render({
      result: input.result,
      config: input.config,
      repository: input.repository,
      pullNumber: input.pullNumber,
      commitSha: input.commitSha,
      headRef: input.headRef,
      baseRef: input.baseRef,
    });
    await this.runRepository.writeFile(input.runDir, 'pr-report.md', markdown);

    if (!input.token) {
      return { reportPath: 'pr-report.md', published: false };
    }

    try {
      await this.githubComment.postComment({
        repository: input.repository,
        pullNumber: input.pullNumber,
        body: markdown,
        token: input.token,
      });
      return { reportPath: 'pr-report.md', published: true };
    } catch (error) {
      const warning = sanitizeWarning(error);
      return { reportPath: 'pr-report.md', published: false, publicationWarning: warning };
    }
  }
}

function sanitizeWarning(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/ghp_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghs_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/gho_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghu_[a-zA-Z0-9_]+/g, '[REDACTED]')
    .replace(/ghr_[a-zA-Z0-9_]+/g, '[REDACTED]');
}
