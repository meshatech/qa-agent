import { Inject, Injectable } from '@nestjs/common';

import type { PipelineAllRunResult, PipelineAllStepRecord, PipelineAllStepStatus } from '../dto/pipeline-all-result.dto.js';
import type { GitHubCommentPort } from '../ports/github-comment.port.js';
import type { GitHubEventContextPort } from '../ports/github-event-context.port.js';
import { CorrelationBlockedError, PreflightBlockedError } from '../../domain/errors.js';
import {
  ExitCodes,
  classifyCorrelationResult,
  classifyError,
  classifyPreflightReport,
  mostSevereExitCode,
  type ExitCode,
} from '../../interfaces/cli/exit-codes.js';
import { RunPipelineCorrelateUseCase } from './run-pipeline-correlate.usecase.js';
import { RunPipelineExecuteUseCase } from './run-pipeline-execute.usecase.js';
import { RunPipelineGeneratePlanUseCase } from './run-pipeline-generate-plan.usecase.js';
import { RunPipelineLearningUseCase } from './run-pipeline-learning.usecase.js';
import { RunPipelinePrepareUseCase } from './run-pipeline-prepare.usecase.js';
import { RunPipelinePromoteLearningUseCase } from './run-pipeline-promote-learning.usecase.js';
import { RunPipelineReportUseCase } from './run-pipeline-report.usecase.js';
import { RunPipelineRiskUseCase } from './run-pipeline-risk.usecase.js';
import { describePreflightBlockedMessage } from '../helpers/describe-preflight-blocked-message.js';

@Injectable()
export class RunPipelineAllUseCase {
  constructor(
    @Inject(RunPipelinePrepareUseCase) private readonly prepare: RunPipelinePrepareUseCase,
    @Inject(RunPipelineCorrelateUseCase) private readonly correlate: RunPipelineCorrelateUseCase,
    @Inject(RunPipelineRiskUseCase) private readonly risk: RunPipelineRiskUseCase,
    @Inject(RunPipelineGeneratePlanUseCase) private readonly generatePlan: RunPipelineGeneratePlanUseCase,
    @Inject(RunPipelineExecuteUseCase) private readonly pipelineExecute: RunPipelineExecuteUseCase,
    @Inject(RunPipelineReportUseCase) private readonly report: RunPipelineReportUseCase,
    @Inject(RunPipelineLearningUseCase) private readonly learning: RunPipelineLearningUseCase,
    @Inject(RunPipelinePromoteLearningUseCase) private readonly promoteLearning: RunPipelinePromoteLearningUseCase,
    @Inject('GitHubCommentPort') private readonly githubComment: GitHubCommentPort,
    @Inject('GitHubEventContextPort') private readonly githubEventContext: GitHubEventContextPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineAllRunResult> {
    const configPath = options?.configPath ?? './agent-qa.config.json';
    const projectPath = options?.projectPath ?? process.cwd();
    const steps: PipelineAllStepRecord[] = [];

    try {
      const prepareResult = await this.prepare.execute(outputDir);
      const prepareExit = classifyPreflightReport(prepareResult.preflightReport);
      if (prepareExit === ExitCodes.PREFLIGHT_BLOCKED) {
        const message = describePreflightBlockedMessage(prepareResult.preflightReport);
        const commentPosted = await this.postBlockedComment(message);
        steps.push(this.recordStep('prepare', 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, message));
        return this.finish(steps, 'prepare', commentPosted);
      }
      steps.push(this.recordStep('prepare', 'OK', prepareExit));
    } catch (err) {
      if (err instanceof PreflightBlockedError) {
        const message = describePreflightBlockedMessage(err.report);
        const commentPosted = await this.postBlockedComment(message);
        steps.push(this.recordStep('prepare', 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, message));
        return this.finish(steps, 'prepare', commentPosted);
      }
      const exitCode = classifyError(err);
      steps.push(this.recordStep('prepare', this.toStepStatus(exitCode), exitCode, this.errorMessage(err)));
      return this.finish(steps);
    }

    try {
      const correlateResult = await this.correlate.execute(outputDir, { projectPath });
      const correlateExit = classifyCorrelationResult(correlateResult.result);
      if (correlateExit === ExitCodes.PREFLIGHT_BLOCKED) {
        const message = correlateResult.result.blockReason ?? 'Pipeline correlation blocked';
        const commentPosted = await this.postBlockedComment(message);
        steps.push(this.recordStep('correlate', 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, message));
        return this.finish(steps, 'correlate', commentPosted);
      }
      steps.push(this.recordStep('correlate', 'OK', correlateExit));
    } catch (err) {
      if (err instanceof CorrelationBlockedError) {
        const message = err.result.blockReason ?? err.message;
        const commentPosted = await this.postBlockedComment(message);
        steps.push(this.recordStep('correlate', 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, message));
        return this.finish(steps, 'correlate', commentPosted);
      }
      const exitCode = classifyError(err);
      steps.push(this.recordStep('correlate', this.toStepStatus(exitCode), exitCode, this.errorMessage(err)));
      return this.finish(steps);
    }

    await this.runStep(steps, 'risk', async () => {
      await this.risk.execute(outputDir, { projectPath });
      return ExitCodes.OK;
    });

    await this.runStep(steps, 'generate-plan', async () => {
      const result = await this.generatePlan.execute(outputDir, { configPath, projectPath });
      return result.executionPlanPath ? ExitCodes.OK : ExitCodes.CONFIG_ERROR;
    });

    await this.runStep(steps, 'execute', async () => {
      const result = await this.pipelineExecute.execute(outputDir, { configPath, projectPath });
      return result.ok ? ExitCodes.OK : ExitCodes.BUGS_FOUND;
    });

    await this.runStep(steps, 'report', async () => {
      const result = await this.report.execute(outputDir, { configPath, projectPath });
      return result.pipelineStatus === 'FAILED' ? ExitCodes.BUGS_FOUND : ExitCodes.OK;
    });

    await this.runStep(steps, 'learning', async () => {
      await this.learning.execute(outputDir, { configPath, projectPath });
      return ExitCodes.OK;
    });

    await this.runStep(steps, 'promote-learning', async () => {
      await this.promoteLearning.execute(outputDir, { projectPath, autoApprove: true });
      return ExitCodes.OK;
    });

    return this.finish(steps);
  }

  private async runStep(
    steps: PipelineAllStepRecord[],
    name: string,
    fn: () => Promise<ExitCode>,
  ): Promise<void> {
    try {
      const exitCode = await fn();
      steps.push(this.recordStep(name, this.toStepStatus(exitCode), exitCode));
    } catch (err) {
      const exitCode = classifyError(err);
      steps.push(this.recordStep(name, this.toStepStatus(exitCode), exitCode, this.errorMessage(err)));
    }
  }

  private recordStep(
    name: string,
    status: PipelineAllStepStatus,
    exitCode: ExitCode,
    message?: string,
  ): PipelineAllStepRecord {
    return { name, status, exitCode, ...(message ? { message } : {}) };
  }

  private toStepStatus(exitCode: ExitCode): PipelineAllStepStatus {
    switch (exitCode) {
      case ExitCodes.OK:
        return 'OK';
      case ExitCodes.PREFLIGHT_BLOCKED:
        return 'BLOCKED';
      case ExitCodes.BUGS_FOUND:
        return 'BUGS_FOUND';
      case ExitCodes.CONFIG_ERROR:
        return 'CONFIG_ERROR';
      default:
        return 'ERROR';
    }
  }

  private finish(
    steps: PipelineAllStepRecord[],
    blockedAt?: string,
    commentPosted?: boolean,
  ): PipelineAllRunResult {
    const exitCodes = steps.map((s) => s.exitCode as ExitCode);
    return {
      steps,
      ...(blockedAt ? { blockedAt } : {}),
      exitCode: mostSevereExitCode(exitCodes),
      ...(commentPosted !== undefined ? { commentPosted } : {}),
    };
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private resolveGitHubToken(): string | undefined {
    const token =
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      process.env.INPUT_GITHUB_TOKEN?.trim();
    return token && token.length > 0 ? token : undefined;
  }

  private async postBlockedComment(body: string): Promise<boolean> {
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
}
