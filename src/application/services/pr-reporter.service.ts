import { Inject, Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { GitHubCommentPort } from '../ports/github-comment.port.js';
import { PRReportRenderer } from './pr-report-renderer.service.js';
import { QaValueMetricsCalculatorService } from './qa-value-metrics-calculator.service.js';
import { buildAcceptanceCriteriaCoverageMap, buildUncoveredCriteria } from './acceptance-criteria-coverage.mapper.js';
import { mapFileToEvidenceLink } from './evidence-link.mapper.js';
import type { EvidenceLink } from './evidence-link.mapper.js';
import { extractBlocksFromResult } from './block-extractor.helper.js';
import { buildPublicationWarning } from './pr-publication-warning-sanitizer.js';
import type { PRPublicationStatus } from './pr-report-renderer.service.js';
import { buildPublicationStatusArtifact } from './pr-publication-status-artifact.js';
import { GitHubCommentError } from '../../domain/errors.js';
import { redactSecretsInMessage } from '../helpers/sanitize-token.js';
import { collectKnownSecretsFromEnv } from './known-secrets.collector.js';

export interface PRReportResult {
  reportPath: string;
  published: boolean;
  publicationWarning?: string;
  publicationStatus?: PRPublicationStatus;
}

@Injectable()
export class PRReporterService {
  private readonly reporterSecrets = collectKnownSecretsFromEnv();

  constructor(
    @Inject('GitHubCommentPort') private readonly githubComment: GitHubCommentPort,
    @Inject('RunRepositoryPort') private readonly runRepository: RunRepositoryPort,
    private readonly renderer: PRReportRenderer,
    private readonly metricsCalculator: QaValueMetricsCalculatorService,
  ) {}

  private finalSanitize(message: string): string {
    return redactSecretsInMessage(message, this.reporterSecrets);
  }

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
    const qaValueMetrics = this.metricsCalculator.compute(input.result, input.config);

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
      qaValueMetrics,
    };

    let publicationStatus: PRPublicationStatus;
    let publicationWarning: string | undefined;
    let attempted = false;
    let statusCode: number | undefined;

    if (!input.token) {
      publicationStatus = { published: false, fallback: true, reason: 'Not published: token not provided' };
      publicationWarning = publicationStatus.reason;
    } else {
      attempted = true;
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
        if (error instanceof GitHubCommentError && error.statusCode !== undefined) {
          statusCode = error.statusCode;
        }
        const warning = buildPublicationWarning(error);
        publicationStatus = { published: false, fallback: true, reason: warning };
        publicationWarning = warning;
      }
    }

    if (publicationStatus.reason) {
      const safeReason = this.finalSanitize(publicationStatus.reason);
      publicationStatus = { ...publicationStatus, reason: safeReason };
      publicationWarning = safeReason;
    }

    const artifact = buildPublicationStatusArtifact({
      attempted,
      published: publicationStatus.published,
      fallback: publicationStatus.fallback,
      reason: publicationStatus.reason,
      repository: input.repository,
      pullNumber: input.pullNumber,
      commitSha: input.commitSha,
      headRef: input.headRef,
      baseRef: input.baseRef,
      statusCode,
    });
    await this.runRepository.writeJson(input.runDir, 'pr-publication-status.json', artifact);

    const finalMarkdown = this.renderer.render({ ...renderInput, publicationStatus });
    await this.runRepository.writeFile(input.runDir, 'pr-report.md', finalMarkdown);

    return { reportPath: 'pr-report.md', published: publicationStatus.published, publicationWarning, publicationStatus };
  }

  private async discoverEvidence(
    runDir: string,
    result: QaRunResult,
  ): Promise<{ byBugId?: Record<string, EvidenceLink[]>; video?: EvidenceLink[]; trace?: EvidenceLink[] }> {
    const byBugId: Record<string, EvidenceLink[]> = {};
    const bugsWithPath = (result.bugs ?? []).filter((bug) => Boolean(bug.path));
    const discovered = await Promise.all(
      bugsWithPath.map(async (bug) => {
        const files = await this.runRepository.listFiles(runDir, bug.path!);
        const links = files
          .map((file) => mapFileToEvidenceLink(`${bug.path}/${file}`))
          .filter((link): link is EvidenceLink => link !== undefined);
        return { bugId: bug.bugId, links };
      }),
    );
    for (const { bugId, links } of discovered) {
      if (links.length > 0) {
        byBugId[bugId] = links;
      }
    }

    const video: EvidenceLink[] = [];
    const trace: EvidenceLink[] = [];
    try {
      const artifacts = await this.runRepository.listFiles(runDir, 'artifacts');
      for (const file of artifacts) {
        if (file.endsWith('.webm')) video.push({ path: `artifacts/${file}`, type: 'video', label: 'Execution video' });
        if (file.endsWith('.zip')) trace.push({ path: `artifacts/${file}`, type: 'trace', label: 'Execution trace' });
      }
    } catch {
      // artifacts dir may not exist
    }

    return { byBugId, video: video.length ? video : undefined, trace: trace.length ? trace : undefined };
  }
}
