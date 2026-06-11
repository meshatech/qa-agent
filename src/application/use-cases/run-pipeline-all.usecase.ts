import { Inject, Injectable } from '@nestjs/common';

import type { PipelineAllRunResult, PipelineAllStepRecord, PipelineAllStepStatus } from '../dto/pipeline-all-result.dto.js';
import { CorrelationBlockedError, PreflightBlockedError } from '../../domain/errors.js';
import { PipelineBlockedNotifier } from '../services/pipeline-blocked-notifier.service.js';
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
    @Inject(PipelineBlockedNotifier) private readonly notifier: PipelineBlockedNotifier,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineAllRunResult> {
    const configPath = options?.configPath ?? './agent-qa.config.json';
    const projectPath = options?.projectPath ?? process.cwd();
    const steps: PipelineAllStepRecord[] = [];

    const prepareResult = await this.runGateStep(
      steps,
      'prepare',
      () => this.prepare.execute(outputDir),
      (result) => classifyPreflightReport(result.preflightReport),
      (result) => describePreflightBlockedMessage(result.preflightReport),
      (err) => (err instanceof PreflightBlockedError ? describePreflightBlockedMessage(err.report) : undefined),
    );
    if (!prepareResult.shouldContinue) return this.finish(steps, 'prepare', prepareResult.commentPosted);

    const correlateResult = await this.runGateStep(
      steps,
      'correlate',
      () => this.correlate.execute(outputDir, { projectPath }),
      (result) => classifyCorrelationResult(result.result),
      (result) => result.result.blockReason ?? 'Pipeline correlation blocked',
      (err) => (err instanceof CorrelationBlockedError ? (err.result.blockReason ?? err.message) : undefined),
    );
    if (!correlateResult.shouldContinue) return this.finish(steps, 'correlate', correlateResult.commentPosted);

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
    const exitCodes = steps.map((s) => s.exitCode);
    return {
      steps,
      ...(blockedAt ? { blockedAt } : {}),
      exitCode: mostSevereExitCode(exitCodes),
      ...(commentPosted !== undefined ? { commentPosted } : {}),
    };
  }

  private async runGateStep<T>(
    steps: PipelineAllStepRecord[],
    name: string,
    execute: () => Promise<T>,
    classify: (result: T) => ExitCode,
    getBlockedMessage: (result: T) => string,
    getErrorBlockedMessage: (err: unknown) => string | undefined,
  ): Promise<{ shouldContinue: boolean; commentPosted?: boolean }> {
    try {
      const result = await execute();
      const exitCode = classify(result);
      if (exitCode === ExitCodes.PREFLIGHT_BLOCKED) {
        const message = getBlockedMessage(result);
        const commentPosted = !!(await this.notifier.notify(message));
        steps.push(this.recordStep(name, 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, message));
        return { shouldContinue: false, commentPosted };
      }
      steps.push(this.recordStep(name, 'OK', exitCode));
      return { shouldContinue: true };
    } catch (err) {
      const blockedMessage = getErrorBlockedMessage(err);
      if (blockedMessage) {
        const commentPosted = !!(await this.notifier.notify(blockedMessage));
        steps.push(this.recordStep(name, 'BLOCKED', ExitCodes.PREFLIGHT_BLOCKED, blockedMessage));
        return { shouldContinue: false, commentPosted };
      }
      const exitCode = classifyError(err);
      steps.push(this.recordStep(name, this.toStepStatus(exitCode), exitCode, this.errorMessage(err)));
      return { shouldContinue: false };
    }
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
