import { Inject, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
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
    let executionOk = false;
    try {
      await this.browser.open(config);
      executionResult = await this.planExecutor.execute(plan, config);
      executionOk = executionResult.ok;
    } finally {
      // Persiste evidência visual ANTES de fechar (no pipeline o vídeo era
      // gravado num temp e descartado). Best-effort: nunca derruba o run.
      await this.persistEvidence(outputDir, config, executionOk).catch(() => undefined);
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

  /**
   * Persiste evidência visual do run no `<outputDir>/evidence/` pra subir no
   * artifact e anexar onde for (PR/ClickUp). Screenshot SEMPRE (estado final),
   * vídeo/trace conforme `config.evidence` ('on' ou 'on-failure' + falhou).
   * `saveVideo`/`saveTrace` fecham o contexto, então rodam por último.
   */
  private async persistEvidence(outputDir: string, config: RunConfig, ok: boolean): Promise<void> {
    const evidenceDir = resolve(join(outputDir, 'evidence'));
    await mkdir(evidenceDir, { recursive: true }).catch(() => undefined);

    const shot = await this.browser.screenshot().catch(() => undefined);
    if (shot) {
      await writeFile(join(evidenceDir, 'final-screenshot.png'), shot).catch(() => undefined);
    }

    const wantTrace = config.evidence?.trace === 'on' || (config.evidence?.trace === 'on-failure' && !ok);
    if (wantTrace) {
      await this.browser.saveTrace(join(evidenceDir, 'trace.zip')).catch(() => undefined);
    }

    const wantVideo = config.evidence?.video === 'on' || (config.evidence?.video === 'on-failure' && !ok);
    if (wantVideo) {
      await this.browser.saveVideo(join(evidenceDir, 'run-video.webm')).catch(() => undefined);
    }
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
