import { Inject, Injectable } from '@nestjs/common';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PipelineReportRunResult } from '../dto/pipeline-report-result.dto.js';
import { PipelineReportRenderer } from '../services/pipeline-report-renderer.service.js';
import type { ConfigLoaderPort } from '../ports/config-loader.port.js';
import { RunConfigSchema } from '../../domain/schemas/config.schema.js';

const PIPELINE_REPORT_FILE = 'pipeline-report.md';
const PREFLIGHT_REPORT_FILE = 'preflight-report.json';
const PR_DIFF_CONTEXT_FILE = 'pr-diff-context.json';
const REQUIRED_SCENARIOS_FILE = 'required-scenarios.json';
const SELECTED_SCENARIOS_FILE = 'selected-scenarios.json';
const EXECUTION_PLAN_FILE = 'execution-plan.json';
const EXECUTION_RESULT_FILE = 'execution-result.json';

@Injectable()
export class RunPipelineReportUseCase {
  constructor(
    @Inject(PipelineReportRenderer) private readonly renderer: PipelineReportRenderer,
    @Inject('ConfigLoaderPort') private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(
    outputDir: string,
    options?: { configPath?: string; projectPath?: string },
  ): Promise<PipelineReportRunResult> {
    const config = await this.loadConfig(options?.configPath ?? 'agent-qa.config.json');

    const preflight = await this.readJsonSafe<Record<string, unknown>>(outputDir, PREFLIGHT_REPORT_FILE);
    const prDiff = await this.readJsonSafe<Record<string, unknown>>(outputDir, PR_DIFF_CONTEXT_FILE);
    const required = await this.readJsonSafe<{ scenarios?: unknown[] }>(outputDir, REQUIRED_SCENARIOS_FILE);
    const selected = await this.readJsonSafe<{ scenarios?: unknown[] }>(outputDir, SELECTED_SCENARIOS_FILE);
    const plan = await this.readJsonSafe<{ steps?: unknown[]; metadata?: Record<string, unknown> }>(outputDir, EXECUTION_PLAN_FILE);
    const result = await this.readJsonSafe<{
      ok?: boolean;
      steps?: unknown[];
      warnings?: Array<{ stepId: string; message: string }>;
      locatorTelemetry?: Array<{ type: string }>;
      failedMessage?: string;
    }>(outputDir, EXECUTION_RESULT_FILE);

    const telemetrySummary = result?.locatorTelemetry
      ? {
          deterministicResolutions: result.locatorTelemetry.filter((t) => t.type === 'deterministic_resolution').length,
          semanticFallbacks: result.locatorTelemetry.filter((t) => t.type === 'semantic_fallback').length,
          llmDecides: result.locatorTelemetry.filter((t) => t.type === 'llm_decide').length,
          replans: result.locatorTelemetry.filter((t) => t.type === 'replan').length,
          targetsNotFound: result.locatorTelemetry.filter((t) => t.type === 'target_not_found').length,
        }
      : undefined;

    const reportInput = {
      demandId: config.demand.id,
      demandTitle: config.demand.title,
      preflightStatus: preflight?.status as string | undefined,
      changedFilesCount: prDiff?.changedFiles ? (prDiff.changedFiles as unknown[]).length : undefined,
      requiredScenariosCount: required?.scenarios?.length,
      selectedScenariosCount: selected?.scenarios?.length,
      executionPlanSteps: plan?.steps?.length,
      executionOk: result?.ok,
      stepsExecuted: result?.steps?.length,
      stepsPassed: result?.ok ? result?.steps?.length : 0,
      stepsFailed: result?.ok === false ? result?.steps?.length : 0,
      warningsCount: result?.warnings?.length,
      locatorTelemetrySummary: telemetrySummary,
      warnings: result?.warnings,
      fallbackReason: plan?.metadata?.fallbackReason as string | undefined,
      executionPlanPath: plan ? resolve(join(outputDir, EXECUTION_PLAN_FILE)) : undefined,
      executionResultPath: result ? resolve(join(outputDir, EXECUTION_RESULT_FILE)) : undefined,
    };

    const markdown = this.renderer.render(reportInput);

    const reportPath = resolve(join(outputDir, PIPELINE_REPORT_FILE));
    await writeFile(reportPath, markdown, 'utf8');

    const sectionsGenerated = [
      ...(reportInput.demandId ? ['Header'] : []),
      ...(reportInput.executionPlanSteps !== undefined ? ['Pipeline Steps'] : []),
      ...(reportInput.stepsExecuted !== undefined ? ['Execution Summary'] : []),
      ...(telemetrySummary ? ['Locator Telemetry'] : []),
      ...(result?.warnings?.length ? ['Warnings'] : []),
      'Artifacts',
    ];

    let pipelineStatus: PipelineReportRunResult['pipelineStatus'] = 'COMPLETED';
    if (result?.ok === false) pipelineStatus = 'FAILED';
    else if (!result || !plan) pipelineStatus = 'PARTIAL';

    return {
      reportPath,
      pipelineStatus,
      sectionsGenerated,
    };
  }

  private async loadConfig(configPath: string) {
    const raw = await this.configLoader.load(configPath);
    return RunConfigSchema.parse(raw);
  }

  private async readJsonSafe<T>(dir: string, filename: string): Promise<T | undefined> {
    try {
      const content = await readFile(join(dir, filename), 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }
}
