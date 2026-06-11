import { Inject, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineExecuteRunResult } from '../dto/pipeline-execute-result.dto.js';
import { readPipelineArtifact } from '../helpers/read-pipeline-artifact.js';
import { PlanExecutorService, type LocatorTelemetryEvent } from '../services/plan-executor.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import type { BrowserHarnessPort } from '../ports/browser-harness.port.js';
import { ExecutionPlanSchema } from '../../domain/schemas/execution-plan.schema.js';
import { RunConfigSchema, type RunConfig } from '../../domain/schemas/config.schema.js';
import { applyBaseUrlOverride } from '../helpers/apply-base-url-override.js';

const EXECUTION_PLAN_FILE = 'execution-plan.json';
const EXECUTION_RESULT_FILE = 'execution-result.json';

@Injectable()
export class RunPipelineExecuteUseCase {
  constructor(
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
    @Inject('BrowserHarnessPort') private readonly browser: BrowserHarnessPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineExecuteRunResult> {
    const plan = await readPipelineArtifact(
      outputDir,
      EXECUTION_PLAN_FILE,
      ExecutionPlanSchema,
    );

    const config = await this.loadConfig(options?.configPath ?? 'agent-qa.config.json');

    let executionResult: import('../services/plan-executor.service.js').PlanExecutionResult;
    try {
      await this.browser.open(config);
      executionResult = await this.planExecutor.execute(plan, config);
    } finally {
      await this.browser.close().catch(() => undefined);
    }

    const executionResultPath = resolve(join(outputDir, EXECUTION_RESULT_FILE));
    await writeFile(
      executionResultPath,
      JSON.stringify(executionResult, null, 2),
      'utf8',
    );

    const telemetry = executionResult.locatorTelemetry ?? [];
    const summary = this.summarizeTelemetry(telemetry);

    const stepsExecuted = executionResult.steps.length;
    const stepsPassed = executionResult.steps.filter((s) => s.validation?.ok && !s.error).length;
    const stepsFailed = executionResult.steps.filter((s) => s.error || !s.validation?.ok).length;

    return {
      ok: executionResult.ok,
      executionResultPath,
      stepsExecuted,
      stepsPassed,
      stepsFailed,
      warningsCount: executionResult.warnings.length,
      locatorTelemetry: telemetry,
      telemetrySummary: summary,
      failedMessage: executionResult.failedMessage,
    };
  }

  private async loadConfig(configPath: string): Promise<RunConfig> {
    const raw = await this.configLoader.load(configPath);
    return applyBaseUrlOverride(RunConfigSchema.parse(raw));
  }

  private summarizeTelemetry(telemetry: LocatorTelemetryEvent[]): PipelineExecuteRunResult['telemetrySummary'] {
    return {
      deterministicResolutions: telemetry.filter((t) => t.type === 'deterministic_resolution').length,
      semanticFallbacks: telemetry.filter((t) => t.type === 'semantic_fallback').length,
      llmDecides: telemetry.filter((t) => t.type === 'llm_decide').length,
      replans: telemetry.filter((t) => t.type === 'replan').length,
      targetsNotFound: telemetry.filter((t) => t.type === 'target_not_found').length,
    };
  }
}
