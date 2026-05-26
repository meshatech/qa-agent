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
}
