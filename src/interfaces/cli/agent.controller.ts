import { Inject, Injectable } from '@nestjs/common';
import type { RunAgentDto } from '../../application/dto/run-agent.dto.js';
import { AgentService } from '../../application/services/agent.service.js';

@Injectable()
export class AgentController {
  constructor(@Inject(AgentService) private readonly service: AgentService) {}
  run(dto: RunAgentDto) {
    return this.service.execute(dto);
  }

  validateConfig(configPath: string) {
    return this.service.validate(configPath);
  }

  inspect(runsDir: string, runId?: string) {
    return this.service.inspect(runsDir, runId);
  }

  report(runsDir: string, runId?: string) {
    return this.service.report(runsDir, runId);
  }

  reportWithFormat(runsDir: string, runId: string | undefined, format: 'md' | 'json') {
    return this.service.reportWithFormat(runsDir, runId, format);
  }

  captureAuth(configPath: string, outputPath: string) {
    return this.service.capture(configPath, outputPath);
  }

  onboard(configPath: string, projectDir?: string, outputDir?: string, headed?: boolean) {
    return this.service.onboard(configPath, projectDir, outputDir, headed);
  }

  preflight(outputDir: string) {
    return this.service.preflight(outputDir);
  }

  readPrContext(outputDir: string) {
    return this.service.readPrContext(outputDir);
  }

  pipelinePrepare(outputDir: string) {
    return this.service.pipelinePrepare(outputDir);
  }

  pipelineCorrelate(outputDir: string, projectPath?: string) {
    return this.service.pipelineCorrelate(outputDir, projectPath);
  }

  pipelineGeneratePlan(outputDir: string, configPath?: string, projectPath?: string) {
    return this.service.pipelineGeneratePlan(outputDir, configPath, projectPath);
  }

  pipelineExecute(outputDir: string, configPath?: string, projectPath?: string) {
    return this.service.pipelineExecute(outputDir, configPath, projectPath);
  }

  pipelineReport(outputDir: string, configPath?: string, projectPath?: string) {
    return this.service.pipelineReport(outputDir, configPath, projectPath);
  }

  pipelineLearning(outputDir: string, configPath?: string, projectPath?: string) {
    return this.service.pipelineLearning(outputDir, configPath, projectPath);
  }

  pipelineGenerateMemory(projectPath?: string, outputDir?: string) {
    return this.service.pipelineGenerateMemory(projectPath, outputDir);
  }

  pipelineRisk(outputDir: string, projectPath?: string) {
    return this.service.pipelineRisk(outputDir, projectPath);
  }

  pipelinePromoteLearning(outputDir: string, configPath?: string, projectPath?: string, autoApprove?: boolean) {
    return this.service.pipelinePromoteLearning(outputDir, configPath, projectPath, autoApprove);
  }

  pipelineAll(outputDir: string, configPath?: string, projectPath?: string) {
    return this.service.pipelineAll(outputDir, configPath, projectPath);
  }
}
