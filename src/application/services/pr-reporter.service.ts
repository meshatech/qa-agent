import { Inject, Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { GitHubCommentPort } from '../ports/github-comment.port.js';
import { PRReportRenderer } from './pr-report-renderer.service.js';
import { buildAcceptanceCriteriaCoverageMap, buildUncoveredCriteria } from './acceptance-criteria-coverage.mapper.js';
import { mapFileToEvidenceLink } from './evidence-link.mapper.js';
import type { EvidenceLink } from './evidence-link.mapper.js';
import { extractBlocksFromResult } from './block-extractor.helper.js';
import { buildPublicationWarning } from './pr-publication-warning-sanitizer.js';
import type { PRPublicationStatus } from './pr-report-renderer.service.js';

export interface PRReportResult {
  reportPath: string;
  published: boolean;
  publicationWarning?: string;
  publicationStatus?: PRPublicationStatus;
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
    const coverageMap = buildAcceptanceCriteriaCoverageMap({
      acceptanceCriteria: input.config.demand?.acceptanceCriteria ?? [],
      scenarios: input.result.scenarios ?? [],
    });
    const uncoveredCriteria = buildUncoveredCriteria({
      acceptanceCriteria: input.config.demand?.acceptanceCriteria ?? [],
      coverageMap,
    });

    let evidenceMap: { byBugId?: Record<string, EvidenceLink[]> } = {};
    try {
      evidenceMap = await this.discoverEvidence(input.runDir, input.result);
    } catch {
      // Evidence discovery failure should not invalidate QA; render without evidence links
    }

    const blocks = extractBlocksFromResult(input.result);

    const renderInput = {
      result: input.result,
      config: input.config,
      repository: input.repository,
      pullNumber: input.pullNumber,
      commitSha: input.commitSha,
      headRef: input.headRef,
      baseRef: input.baseRef,
      coverageMap,
      uncoveredCriteria,
      evidenceMap,
      blocks,
    };

    let publicationStatus: PRPublicationStatus;
    let publicationWarning: string | undefined;

    if (!input.token) {
      publicationStatus = { published: false, fallback: true, reason: 'Not published: token not provided' };
      publicationWarning = publicationStatus.reason;
    } else {
      const commentBody = this.renderer.render(renderInput);
      try {
        await this.githubComment.postComment({
          repository: input.repository,
          pullNumber: input.pullNumber,
          body: commentBody,
          token: input.token,
        });
        publicationStatus = { published: true, fallback: false };
      } catch (error) {
        const warning = buildPublicationWarning(error);
        publicationStatus = { published: false, fallback: true, reason: warning };
        publicationWarning = warning;
      }
    }

    const finalMarkdown = this.renderer.render({ ...renderInput, publicationStatus });
    await this.runRepository.writeFile(input.runDir, 'pr-report.md', finalMarkdown);

    return { reportPath: 'pr-report.md', published: publicationStatus.published, publicationWarning, publicationStatus };
  }

  private async discoverEvidence(
    runDir: string,
    result: QaRunResult,
  ): Promise<{ byBugId?: Record<string, EvidenceLink[]> }> {
    const byBugId: Record<string, EvidenceLink[]> = {};
    for (const bug of result.bugs ?? []) {
      if (!bug.path) continue;
      const files = await this.runRepository.listFiles(runDir, bug.path);
      const links = files
        .map((file) => mapFileToEvidenceLink(`${bug.path}/${file}`))
        .filter((link): link is EvidenceLink => link !== undefined);
      if (links.length > 0) {
        byBugId[bug.bugId] = links;
      }
    }
    return { byBugId };
  }
}
