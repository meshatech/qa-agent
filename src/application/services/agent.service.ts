import { Inject, Injectable } from '@nestjs/common';
import type { RunAgentDto } from '../dto/run-agent.dto.js';
import { RunAgentUseCase } from '../use-cases/run-agent.usecase.js';
import { ValidateConfigUseCase } from '../use-cases/validate-config.usecase.js';
import { InspectRunUseCase } from '../use-cases/inspect-run.usecase.js';
import { ReportRunUseCase } from '../use-cases/report-run.usecase.js';
import { CaptureAuthUseCase } from '../use-cases/capture-auth.usecase.js';

@Injectable()
export class AgentService {
  constructor(
    @Inject(RunAgentUseCase) private readonly runAgent: RunAgentUseCase,
    @Inject(ValidateConfigUseCase) private readonly validateConfig: ValidateConfigUseCase,
    @Inject(InspectRunUseCase) private readonly inspectRun: InspectRunUseCase,
    @Inject(ReportRunUseCase) private readonly reportRun: ReportRunUseCase,
    @Inject(CaptureAuthUseCase) private readonly captureAuth: CaptureAuthUseCase,
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
}
