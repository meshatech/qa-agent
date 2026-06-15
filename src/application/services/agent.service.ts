import { Inject, Injectable } from '@nestjs/common';
import type { RunAgentDto } from '../dto/run-agent.dto.js';
import { RunAgentUseCase } from '../use-cases/run-agent.usecase.js';
import { ValidateConfigUseCase } from '../use-cases/validate-config.usecase.js';
import { InspectRunUseCase } from '../use-cases/inspect-run.usecase.js';
import { ReportRunUseCase } from '../use-cases/report-run.usecase.js';
import { CaptureAuthUseCase } from '../use-cases/capture-auth.usecase.js';
import { RunOnboardingUseCase } from '../use-cases/run-onboarding.usecase.js';
import { RunPipelinePreflightUseCase } from '../use-cases/run-pipeline-preflight.usecase.js';
import { RunPrDiffContextUseCase } from '../use-cases/run-pr-diff-context.usecase.js';
import { RunPipelinePrepareUseCase } from '../use-cases/run-pipeline-prepare.usecase.js';
import { RunPipelineCorrelateUseCase } from '../use-cases/run-pipeline-correlate.usecase.js';
import { RunPipelineGeneratePlanUseCase } from '../use-cases/run-pipeline-generate-plan.usecase.js';
import { RunPipelineExecuteUseCase } from '../use-cases/run-pipeline-execute.usecase.js';
import { RunPipelineReportUseCase } from '../use-cases/run-pipeline-report.usecase.js';
import { RunPipelineLearningUseCase } from '../use-cases/run-pipeline-learning.usecase.js';
import { RunPipelineGenerateMemoryUseCase } from '../use-cases/run-pipeline-generate-memory.usecase.js';
import { RunPipelineRiskUseCase } from '../use-cases/run-pipeline-risk.usecase.js';
import { RunPipelinePromoteLearningUseCase } from '../use-cases/run-pipeline-promote-learning.usecase.js';
import { RunPipelineAllUseCase } from '../use-cases/run-pipeline-all.usecase.js';
import type { PipelinePreflightRunResult } from '../dto/pipeline-preflight-result.dto.js';
import type { PrDiffContextRunResult } from '../dto/pr-diff-context-result.dto.js';
import type { PipelinePrepareRunResult } from '../dto/pipeline-prepare-result.dto.js';
import type { PipelineCorrelateRunResult } from '../dto/pipeline-correlate-result.dto.js';
import type { PipelineGeneratePlanRunResult } from '../dto/pipeline-generate-plan-result.dto.js';
import type { PipelineReportRunResult } from '../dto/pipeline-report-result.dto.js';
import type { PipelineLearningRunResult } from '../dto/pipeline-learning-result.dto.js';
import type { PipelineGenerateMemoryRunResult } from '../dto/pipeline-generate-memory-result.dto.js';
import type { PipelineRiskRunResult } from '../dto/pipeline-risk-result.dto.js';
import type { PipelinePromoteLearningRunResult } from '../dto/pipeline-promote-learning-result.dto.js';
import type { PipelineAllRunResult } from '../dto/pipeline-all-result.dto.js';
import type { OnboardingResult } from '../../domain/models/readiness.model.js';

@Injectable()
export class AgentService {
  constructor(
    @Inject(RunAgentUseCase) private readonly runAgent: RunAgentUseCase,
    @Inject(ValidateConfigUseCase) private readonly validateConfig: ValidateConfigUseCase,
    @Inject(InspectRunUseCase) private readonly inspectRun: InspectRunUseCase,
    @Inject(ReportRunUseCase) private readonly reportRun: ReportRunUseCase,
    @Inject(CaptureAuthUseCase) private readonly captureAuth: CaptureAuthUseCase,
    @Inject(RunOnboardingUseCase) private readonly runOnboarding: RunOnboardingUseCase,
    @Inject(RunPipelinePreflightUseCase) private readonly runPipelinePreflight: RunPipelinePreflightUseCase,
    @Inject(RunPrDiffContextUseCase) private readonly runPrDiffContext: RunPrDiffContextUseCase,
    @Inject(RunPipelinePrepareUseCase) private readonly runPipelinePrepare: RunPipelinePrepareUseCase,
    @Inject(RunPipelineCorrelateUseCase) private readonly runPipelineCorrelate: RunPipelineCorrelateUseCase,
    @Inject(RunPipelineGeneratePlanUseCase) private readonly runPipelineGeneratePlan: RunPipelineGeneratePlanUseCase,
    @Inject(RunPipelineExecuteUseCase) private readonly runPipelineExecute: RunPipelineExecuteUseCase,
    @Inject(RunPipelineReportUseCase) private readonly runPipelineReport: RunPipelineReportUseCase,
    @Inject(RunPipelineLearningUseCase) private readonly runPipelineLearning: RunPipelineLearningUseCase,
    @Inject(RunPipelineGenerateMemoryUseCase) private readonly runPipelineGenerateMemory: RunPipelineGenerateMemoryUseCase,
    @Inject(RunPipelineRiskUseCase) private readonly runPipelineRisk: RunPipelineRiskUseCase,
    @Inject(RunPipelinePromoteLearningUseCase) private readonly runPipelinePromoteLearning: RunPipelinePromoteLearningUseCase,
    @Inject(RunPipelineAllUseCase) private readonly runPipelineAll: RunPipelineAllUseCase,
  ) {}

  execute(dto: RunAgentDto) {
    return this.runAgent.execute(dto);
  }

  validate(configPath: string) {
    return this.validateConfig.execute(configPath);
  }

  inspect(runsDir: string, runId?: string) {
    return this.inspectRun.execute(runsDir, runId);
  }

  report(runsDir: string, runId?: string) {
    return this.reportRun.execute(runsDir, runId, 'md');
  }

  reportWithFormat(runsDir: string, runId: string | undefined, format: 'md' | 'json') {
    return this.reportRun.execute(runsDir, runId, format);
  }

  capture(configPath: string, outputPath: string) {
    return this.captureAuth.execute(configPath, outputPath);
  }

  onboard(configPath: string, projectDir?: string, outputDir?: string, headed?: boolean): Promise<OnboardingResult> {
    return this.runOnboarding.execute(configPath, projectDir, outputDir, { headed });
  }

  preflight(outputDir: string): Promise<PipelinePreflightRunResult> {
    return this.runPipelinePreflight.execute(outputDir);
  }

  readPrContext(outputDir: string): Promise<PrDiffContextRunResult> {
    return this.runPrDiffContext.execute(outputDir);
  }

  pipelinePrepare(outputDir: string): Promise<PipelinePrepareRunResult> {
    return this.runPipelinePrepare.execute(outputDir);
  }

  pipelineCorrelate(outputDir: string, projectPath?: string): Promise<PipelineCorrelateRunResult> {
    return this.runPipelineCorrelate.execute(outputDir, { projectPath });
  }

  pipelineGeneratePlan(outputDir: string, configPath?: string, projectPath?: string): Promise<PipelineGeneratePlanRunResult> {
    return this.runPipelineGeneratePlan.execute(outputDir, { configPath, projectPath });
  }

  pipelineExecute(outputDir: string, configPath?: string, projectPath?: string) {
    return this.runPipelineExecute.execute(outputDir, { configPath, projectPath });
  }

  pipelineReport(outputDir: string, configPath?: string, projectPath?: string): Promise<PipelineReportRunResult> {
    return this.runPipelineReport.execute(outputDir, { configPath, projectPath });
  }

  pipelineLearning(outputDir: string, configPath?: string, projectPath?: string): Promise<PipelineLearningRunResult> {
    return this.runPipelineLearning.execute(outputDir, { configPath, projectPath });
  }

  pipelineGenerateMemory(projectPath?: string, outputDir?: string): Promise<PipelineGenerateMemoryRunResult> {
    return this.runPipelineGenerateMemory.execute(projectPath ?? process.cwd(), { outputDir });
  }

  pipelineRisk(outputDir: string, projectPath?: string): Promise<PipelineRiskRunResult> {
    return this.runPipelineRisk.execute(outputDir, { projectPath });
  }

  pipelinePromoteLearning(outputDir: string, configPath?: string, projectPath?: string, autoApprove?: boolean): Promise<PipelinePromoteLearningRunResult> {
    return this.runPipelinePromoteLearning.execute(outputDir, { configPath, projectPath, autoApprove });
  }

  pipelineAll(outputDir: string, configPath?: string, projectPath?: string): Promise<PipelineAllRunResult> {
    return this.runPipelineAll.execute(outputDir, { configPath, projectPath });
  }
}
