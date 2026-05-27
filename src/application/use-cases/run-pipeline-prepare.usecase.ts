import { Inject, Injectable } from '@nestjs/common';

import type { PipelinePrepareRunResult } from '../dto/pipeline-prepare-result.dto.js';
import { RunPipelinePreflightUseCase } from './run-pipeline-preflight.usecase.js';
import { RunPrDiffContextUseCase } from './run-pr-diff-context.usecase.js';

@Injectable()
export class RunPipelinePrepareUseCase {
  constructor(
    @Inject(RunPipelinePreflightUseCase) private readonly preflight: RunPipelinePreflightUseCase,
    @Inject(RunPrDiffContextUseCase) private readonly readPrContext: RunPrDiffContextUseCase,
  ) {}

  async execute(outputDir: string): Promise<PipelinePrepareRunResult> {
    const preflight = await this.preflight.execute(outputDir);
    const prDiff = await this.readPrContext.execute(outputDir);

    return {
      preflightReport: preflight.report,
      preflightReportPath: preflight.reportPath,
      prDiffContext: prDiff.context,
      prDiffContextPath: prDiff.contextPath,
      tokensMasked: prDiff.tokensMasked,
    };
  }
}
