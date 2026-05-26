import { Inject, Injectable } from '@nestjs/common';

import type { PipelinePreflightRunResult } from '../dto/pipeline-preflight-result.dto.js';
import { PipelinePreflightService } from '../services/pipeline-preflight.service.js';

@Injectable()
export class RunPipelinePreflightUseCase {
  constructor(@Inject(PipelinePreflightService) private readonly preflight: PipelinePreflightService) {}

  execute(outputDir: string): Promise<PipelinePreflightRunResult> {
    return this.preflight.runOrThrow(outputDir);
  }
}
