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
import type { PipelinePreflightRunResult } from '../dto/pipeline-preflight-result.dto.js';
import type { PrDiffContextRunResult } from '../dto/pr-diff-context-result.dto.js';
import type { PipelinePrepareRunResult } from '../dto/pipeline-prepare-result.dto.js';
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
}
